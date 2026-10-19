// The default GUI: every section as a tab, using the shared Basecoat shell and the modules' default views.
import { startShell } from '../../ui/basecoat/shell.js';

export default ({ gui, modules }) => startShell({ gui, modules });
