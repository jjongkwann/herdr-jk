import { View, div } from "gpui-kit";
import { spaces, panes, focused, exec, notify, nextCommand, shared, setShared } from "herdr";
import { closeSafely } from "./safe-close.js";

export default class OmarchyClose extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      const api = {
        spaces, panes, focused, notify,
        sleep: ms => cx.sleep(ms),
        command: async (command, args) => {
          const result = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
          if (result.code !== 0) throw new Error(result.stderr || result.stdout);
          const value = JSON.parse(result.stdout);
          if (value.error) throw new Error(value.error);
          return value;
        },
      };
      for (;;) {
        const command = await nextCommand();
        if (command === "pane" || command === "tab") {
          await closeSafely(`${command}.close`, {}, api);
        } else if (command === "process") {
          while (shared("omarchy-close.requests")?.length) {
            const [request, ...rest] = shared("omarchy-close.requests");
            setShared("omarchy-close.requests", rest);
            await closeSafely(request.command, request.args, api);
          }
        }
        cx.notify();
      }
    });
  }
  render() { return div().size_full(); }
}
