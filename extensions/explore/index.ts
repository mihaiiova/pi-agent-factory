import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerExplore } from "./runtime.mjs";

export default function explore(pi: ExtensionAPI) {
  registerExplore(pi, Type.Object({
    action: Type.Union([Type.Literal("on"), Type.Literal("off"), Type.Literal("status")]),
    objective: Type.Optional(Type.String()),
  }));
}
