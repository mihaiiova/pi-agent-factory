#!/usr/bin/env bash
set -euo pipefail

# Apply a validated /spec-new plan to GitHub.
# - validates before mutation
# - specs are the only implementation units
# - creates epic children in dependency-safe order
# - resolves stable ids to real issue URLs
# - idempotent + convergent: same plan_id/artifact id reuses and updates issues

plan="${1:?usage: apply-plan.sh PLAN_JSON}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/validate-plan.sh" "$plan" >/dev/null

# Prefer an explicit automation token, but in an interactive Pi session reuse the
# authenticated GitHub CLI token so spec publishing does not fail unnecessarily.
if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_TOKEN="$(gh auth token 2>/dev/null || true)"
fi
: "${GH_TOKEN:?GH_TOKEN is required; run gh auth login or set GH_TOKEN}"
export GH_TOKEN
PI_REPOSITORY="${PI_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
[[ -n "$PI_REPOSITORY" ]] || { echo "apply-plan: could not determine repository" >&2; exit 1; }

trap 'c=$?; if [[ $c -ne 0 ]]; then echo "apply-plan: failed (exit $c). Re-run /spec-new with the same plan_id to resume; existing artifacts will be reused and converged." >&2; fi' ERR

kind="$(jq -r '.kind' "$plan")"
plan_id="$(jq -r '.plan_id' "$plan")"

marker_for() {
  local artifact_kind="$1" artifact_id="$2"
  printf '<!-- pi:new-spec:v2 repo=%s plan=%s kind=%s id=%s -->' "$PI_REPOSITORY" "$plan_id" "$artifact_kind" "$artifact_id"
}

ensure_label() {
  local label="$1"
  gh label create "$label" --repo "$PI_REPOSITORY" --color BFD4F2 --description "spec lifecycle" >/dev/null 2>&1 || true
}

add_label() {
  local num="$1" label="$2"
  ensure_label "$label"
  gh issue edit "$num" --repo "$PI_REPOSITORY" --add-label "$label" >/dev/null
}

set_state_label() {
  local num="$1" desired="$2" state
  for state in spec:ready spec:in-progress spec:reviewed spec:done; do
    if [[ "$state" != "$desired" ]]; then
      gh issue edit "$num" --repo "$PI_REPOSITORY" --remove-label "$state" >/dev/null 2>&1 || true
    fi
  done
  add_label "$num" "$desired"
}

ensure_ready_if_planning() {
  local num="$1" labels
  labels="$(gh issue view "$num" --repo "$PI_REPOSITORY" --json labels --jq '[.labels[].name]')"
  if jq -e 'any(.[]; . == "spec:in-progress" or . == "spec:reviewed" or . == "spec:done")' <<< "$labels" >/dev/null; then
    return 0
  fi
  set_state_label "$num" "spec:ready"
}

find_existing_url() {
  local marker="$1" result count
  result="$(gh issue list --repo "$PI_REPOSITORY" --state all --limit 1000 --json body,url \
    | jq --arg marker "$marker" '[.[] | select((.body // "") | contains($marker)) | .url]')"
  count="$(jq 'length' <<< "$result")"
  if [[ "$count" == "0" ]]; then printf ''; return 0; fi
  [[ "$count" == "1" ]] || { echo "apply-plan: multiple issues contain marker: $marker" >&2; return 1; }
  jq -r '.[0]' <<< "$result"
}

num_of() { basename "$1"; }

create_or_converge() {
  local title="$1" body_file="$2" labels_json="$3" marker="$4"
  local existing num label
  existing="$(find_existing_url "$marker")"
  if [[ -n "$existing" ]]; then
    num="$(num_of "$existing")"
    gh issue edit "$num" --repo "$PI_REPOSITORY" --title "$title" --body-file "$body_file" >/dev/null
    while IFS= read -r label; do
      [[ -n "$label" ]] && add_label "$num" "$label"
    done < <(jq -r '.[]' <<< "$labels_json")
    printf '%s' "$existing"
    return 0
  fi

  local args=(issue create --repo "$PI_REPOSITORY" --title "$title" --body-file "$body_file")
  while IFS= read -r label; do
    if [[ -n "$label" ]]; then
      ensure_label "$label"
      args+=(--label "$label")
    fi
  done < <(jq -r '.[]' <<< "$labels_json")
  gh "${args[@]}"
}

if [[ "$kind" == "spec" ]]; then
  spec_id="$(jq -r '.spec.id' "$plan")"
  spec_title="$(jq -r '.spec.title' "$plan")"
  spec_labels="$(jq -c '.spec.labels // []' "$plan")"
  spec_marker="$(marker_for spec "$spec_id")"
  spec_body_file="$(mktemp)"
  jq -r --arg m "$spec_marker" '.spec.body + "\n\n" + $m' "$plan" > "$spec_body_file"
  spec_url="$(create_or_converge "$spec_title" "$spec_body_file" "$spec_labels" "$spec_marker")"
  ensure_ready_if_planning "$(num_of "$spec_url")"
  echo "spec (id=$spec_id) $spec_title -> $spec_url"

elif [[ "$kind" == "epic" ]]; then
  epic_id="$(jq -r '.epic.id' "$plan")"
  epic_title="$(jq -r '.epic.title' "$plan")"
  epic_labels="$(jq -c '.epic.labels // []' "$plan")"
  epic_marker="$(marker_for epic "$epic_id")"

  epic_initial="$(mktemp)"
  jq -r --arg m "$epic_marker" '.epic.body + "\n\n" + $m' "$plan" > "$epic_initial"
  epic_url="$(create_or_converge "$epic_title" "$epic_initial" "$epic_labels" "$epic_marker")"
  epic_num="$(num_of "$epic_url")"
  add_label "$epic_num" "spec:epic"

  child_state="$(mktemp)"
  child_list="$(mktemp)"
  printf '[]\n' > "$child_state"

  while IFS= read -r spec; do
    s_id="$(jq -r '.id' <<< "$spec")"
    s_title="$(jq -r '.title' <<< "$spec")"
    s_body="$(jq -r '.body' <<< "$spec")"
    s_labels="$(jq -c '.labels // []' <<< "$spec")"
    blockers="$(jq -c '.blocked_by // []' <<< "$spec")"

    blocked_section="## Blocked by"
    if [[ "$(jq 'length' <<< "$blockers")" -eq 0 ]]; then
      blocked_section+=$'\n\nNone — can start immediately.'
    else
      while IFS= read -r b_id; do
        b_url="$(jq -er --arg id "$b_id" '.[] | select(.id == $id) | .url' "$child_state")"
        b_title="$(jq -er --arg id "$b_id" '.[] | select(.id == $id) | .title' "$child_state")"
        blocked_section+=$'\n\n- '
        blocked_section+="[$b_title]($b_url)"
      done < <(jq -r '.[]' <<< "$blockers")
    fi

    full_body="$(printf '## Parent\n\n[%s](%s)\n\n%s\n\n%s' "$epic_title" "$epic_url" "$s_body" "$blocked_section")"
    s_marker="$(marker_for child "$s_id")"
    s_body_file="$(mktemp)"
    printf '%s\n\n%s' "$full_body" "$s_marker" > "$s_body_file"
    s_url="$(create_or_converge "$s_title" "$s_body_file" "$s_labels" "$s_marker")"

    if [[ "$(jq 'length' <<< "$blockers")" -eq 0 ]]; then
      ensure_ready_if_planning "$(num_of "$s_url")"
    fi

    jq --arg id "$s_id" --arg title "$s_title" --arg url "$s_url" \
      '. + [{id:$id,title:$title,url:$url}]' "$child_state" > "$child_state.next"
    mv "$child_state.next" "$child_state"
    printf '%s\t%s\n' "$s_title" "$s_url" >> "$child_list"
    printf 'child\t%s\t%s\n' "$s_title" "$s_url"
  done < <(jq -c '.specs[]' "$plan")

  child_links=""
  while IFS=$'\t' read -r title url; do
    [[ -n "$title" ]] && child_links+="- [$title]($url)"$'\n'
  done < "$child_list"

  full_epic_body="$(jq -r '.epic.body' "$plan")"$'\n\n## Child spec issues\n\n'"$child_links"$'\n'"$epic_marker"
  epic_final="$(mktemp)"
  printf '%s' "$full_epic_body" > "$epic_final"
  gh issue edit "$epic_num" --repo "$PI_REPOSITORY" --title "$epic_title" --body-file "$epic_final" >/dev/null

  echo "epic (id=$epic_id) $epic_title -> $epic_url"
else
  echo "apply-plan: unknown kind '$kind'" >&2
  exit 1
fi

echo "plan applied: plan_id=$plan_id kind=$kind"
