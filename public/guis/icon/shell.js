// Icon GUI: the shared Basecoat shell with every section; Quests uses the trader view in views/quests.js.
import { startShell } from '../../ui/basecoat/shell.js';

export default ({ gui, modules }) => startShell({ gui, modules, className: 'icon-gui' });
