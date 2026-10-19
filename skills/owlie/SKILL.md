---
name: owlie
description: >
  Local-first content extraction and LLM processing with the `owlie` CLI —
  pull YouTube transcripts, transcribe podcast audio, extract article text,
  and list or batch-process RSS/Atom feeds, then run DeepSeek or OpenAI
  prompts over the result. Use when the user wants to transcribe a video or
  podcast, extract text from a URL or feed, summarize or process content, or
  set up owlie credentials.
---

# Owlie

`owlie` is a local-first, pipeable CLI. It turns sources (YouTube, podcasts,
articles, RSS/Atom feeds) into normalized text, then runs LLM prompts over
that text with DeepSeek or OpenAI. Results go to **stdout**, diagnostics to
**stderr**, so commands compose over Unix pipes.

**This skill documents the published `0.4.0` CLI.** The `owlie-cli` repo
(`/home/ops/projects/owlie-cli`, `docs/`) tracks a newer unreleased surface
(`--hosted`, `capabilities`, `--max-network-bytes`, `--max-stdout-bytes`, a
versioned `--json` envelope, exit `130`). Flags change between releases —
`owlie <cmd> --help` and `owlie --version` are authoritative over this file.
Use the repo only for schema/architecture detail, not for development
(developing `owlie-cli` is a separate task governed by its own `AGENTS.md`).

## Preflight

```bash
command -v owlie && owlie --version   # 0.4.x
owlie doctor                          # key/model/transcription readiness
```

Not installed? `npm install -g @owlieio/owlie` (npm package `@owlieio/owlie`;
command `owlie`).

## Credentials

LLM processing is BYOK with two providers — `deepseek` and `openai`. Configure
one before `owlie process`:

```bash
owlie auth add deepseek   # prompts for the key, stores it (never echoes it)
owlie auth list           # each provider + credential source; never the key
owlie setup               # interactive: provider, model, key, optional proxy
```

Or via environment (precedence: `process env` > `.env.local` > `.env` > saved
profile):

```text
DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
OPENAI_API_KEY   / OPENAI_BASE_URL   / OPENAI_MODEL
OWLIE_PROVIDER   # fallback provider when --model has no provider/
```

Select the model with `--model provider/model-id` (self-contained; preferred).
A bare `--model id` resolves the provider from the saved active profile or
`OWLIE_PROVIDER`. Discover live ids with `owlie models [--provider p] [--refresh]`.

## Commands

| Command | What it does |
| --- | --- |
| `owlie extract URL` | Normalized text from a YouTube video, static article, podcast episode, or a feed's linked items |
| `owlie resolve URL` | Print the validated audio media URL (no download/transcription) |
| `owlie list FEED_URL` | List entries in an RSS/Atom feed |
| `owlie process [FILE\|URL] --prompt "..."` | Run an LLM prompt over text, a document, or a URL |
| `owlie models [--provider p]` | List live model ids (cached 1h) |
| `owlie auth add\|list\|remove p` | Manage API keys |
| `owlie setup` / `owlie doctor` | Configure interactively / report health |

## Recipes

### YouTube transcript

```bash
owlie extract "https://www.youtube.com/watch?v=..."          # raw text
owlie extract "https://www.youtube.com/watch?v=..." --json   # JSON NormalizedDocument
owlie extract "https://www.youtube.com/watch?v=..." --language en,es
```

### Article

```bash
owlie extract "https://example.com/story"   # server-rendered pages only; no JS rendering
```

### Podcast transcription (local)

Needs local **python3 + faster-whisper**, **ffmpeg**, **ffprobe**, and a
pre-provisioned Whisper model — `owlie` never downloads model weights. Check
`owlie doctor` first.

```bash
owlie resolve "https://podcasts.apple.com/us/podcast/example/id12345?i=67890"
owlie extract "https://cdn.example.com/episode.mp3" --timeout-ms 900000 --max-media-bytes 536870912
owlie extract "https://podcasts.apple.com/us/podcast/example/id12345?i=67890"
# force one resolver (no fallback): --podcast-media | --podcast-page | --podcast-apple
```

### Feeds

```bash
owlie list "https://example.com/feed.xml" --limit 20          # list entries
owlie extract "https://example.com/feed.xml" --limit 20        # batch-extract, one JSON result
owlie process "https://example.com/feed.xml" --each --limit 20 --prompt "Summarize each"  # JSONL per item
```

### LLM processing

`owlie process URL --prompt "..."` extracts *and* processes in one step — the
default for "summarize this video/article." Reach for `extract | process` only
when you need the intermediate text (inspect it, save it, or run several
prompts against one extraction). Plain `extract` needs no credentials; `process`
requires a configured provider + model.

> `process URL` needs a TTY stdin — in a piped/agent shell it fails with
> `cannot combine a URL with piped stdin`. Use the pipe form below or
> `--input FILE` there, or allocate a pseudo-TTY: `script -qec 'owlie process …' /dev/null`.

```bash
owlie process "https://www.youtube.com/watch?v=..." --prompt "Summarize this"
owlie process "https://example.com/article" --prompt "Summarize"          # URL extracted first
owlie process transcript.txt --prompt "Extract claims" --model openai/gpt-4o-mini

# extract-then-process, when you want the text in between
owlie extract "https://www.youtube.com/watch?v=..." | owlie process --prompt "Summarize this"
owlie extract "https://www.youtube.com/watch?v=..." --json |
  owlie process --input-format json --prompt "List key claims"
```

## Conventions

- **stdout** = result only; **stderr** = diagnostics/progress. `--quiet`/`-q`
  silences stderr. Pipe freely.
- **`--json`** emits the command's JSON document on stdout. In `0.4.0` it is a
  plain per-command object; if a `schemaVersion` field appears, you are on the
  newer versioned-envelope protocol — parse it accordingly.
- **Exit codes:** `0` success, `1` error, `2` usage, `3` not implemented.
- **Bounds:** `--limit` default 10, max 500; every collection operation is bounded.
- **Single input only:** `process` reads exactly one of positional URL, file,
  `--input FILE`, or stdin. A feed URL in single mode is rejected — use `--each`.
  Empty piped stdin is an error.
- **Transcription is the heavy path** — needs the full local faster-whisper
  stack and a provisioned model. YouTube transcripts and article text need
  nothing extra.
