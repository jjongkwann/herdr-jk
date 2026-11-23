import { shared, setShared, run, focused } from "herdr";

// after: { command, args } to run once this close went through (omarchy-close skips it otherwise).
export function requestClose(command, args = {}, after = null) {
  const focus = focused();
  const target = command === "tab.close" ? { id: args.id ?? focus?.tab }
    : command === "pane.close" ? { pane: args.pane ?? focus?.pane } : args;
  if (command === "pane.close" && !target.pane) return;
  if (command === "tab.close" && !target.id) return;
  setShared("omarchy-close.requests", [...(shared("omarchy-close.requests") ?? []), { command, args: target, ...(after ? { after } : {}) }]);
  run("omarchy-close.process");
}
