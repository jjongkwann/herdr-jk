export async function closeSafely(command, args, api) {
  if (!['tab.close', 'pane.close', 'terminal.kill'].includes(command)) return;
  const focus = api.focused();
  const panes = api.panes();
  const pane = command === 'pane.close'
    ? panes.find(p => p.pane === (args.pane ?? focus?.pane))
    : command === 'terminal.kill' ? panes.find(p => p.terminal === args.terminal) : null;
  const tab = command === 'tab.close' ? args.id ?? focus?.tab : pane?.tab;
  const space = api.spaces().find(s => s.tabs.some(t => t.id === tab));
  const target = command === 'tab.close' ? { id: tab }
    : command === 'pane.close' ? { pane: pane?.pane } : { terminal: args.terminal };
  if (command === 'terminal.kill' && !pane) {
    if (args.terminal) {
      try { await api.command(command, target); }
      catch (error) { api.notify({ title: 'Could not stop agent', body: String(error), level: 'error' }); }
    }
    return;
  }
  if (!space || (command === 'pane.close' && !pane)) return;
  const tabPanes = panes.filter(p => p.tab === tab);
  const last = space.tabs.length === 1 && (command === 'tab.close' || tabPanes.length === 1);
  let created;
  try {
    if (last) {
      const terminal = pane ?? tabPanes.find(p => p.pane === focus?.pane && p.cwd) ?? tabPanes.find(p => p.cwd);
      const folder = terminal?.cwd || space.folder;
      const create = directory => api.command('tab.new', { space: space.id, ...(directory ? { folder: directory } : {}) });
      try { created = await create(folder); }
      catch (error) {
        if (folder === space.folder) throw error;
        created = await create(space.folder);
      }
      if (created?.space !== space.id || !created.tab || created.tab === tab || !created.terminal) {
        throw new Error('Replacement shell was not confirmed. Original left open.');
      }
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = api.spaces().find(s => s.id === space.id);
        if (!current || !current.tabs.some(t => t.id === tab)) return;
        ready = current.tabs.some(t => t.id === created.tab)
          && api.panes().some(p => p.tab === created.tab && p.terminal === created.terminal);
        if (ready) break;
        await api.sleep(25);
      }
      if (!ready) throw new Error('Replacement shell did not appear. Original left open.');
    }
    const current = api.spaces().find(s => s.id === space.id);
    if (!current?.tabs.some(t => t.id === tab)) return;
    if (pane && !api.panes().some(p => p.pane === pane.pane && p.tab === tab)) return;
    await api.command(command, target);
    if (created && focus?.tab !== tab && api.focused()?.tab === created.tab
        && api.spaces().some(s => s.tabs.some(t => t.id === focus?.tab))) {
      await api.command('tab.select', { id: focus.tab });
    }
  } catch (error) {
    api.notify({ title: 'Could not close safely', body: String(error), level: 'error' });
  }
}
