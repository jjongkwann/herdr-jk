import { shared, setShared, run, focused } from "herdr";

export function requestClose(command, args = {}) {
  const focus = focused();
  const target = command === "tab.close" ? { id: args.id ?? focus?.tab }
    : command === "pane.close" ? { pane: args.pane ?? focus?.pane } : args;
  if (command === "pane.close" && !target.pane) return;
  if (command === "tab.close" && !target.id) return;
  setShared("omarchy-close.requests", [...(shared("omarchy-close.requests") ?? []), { command, args: target }]);
  run("omarchy-close.process");
}
