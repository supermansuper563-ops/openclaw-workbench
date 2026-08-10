import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";

async function loadWorkbench(context: ApplicationContext): Promise<void> {
  await Promise.all([
    context.runtimeConfig.ensureLoaded(),
    context.agents.ensureList(),
    context.channels.refresh(false),
  ]);
}

export const page = definePage({
  ...routePageSpec("workbench"),
  loader: (context: ApplicationContext) => loadWorkbench(context),
  component: () =>
    import("./workbench-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-workbench-page></openclaw-workbench-page>`,
    })),
});
