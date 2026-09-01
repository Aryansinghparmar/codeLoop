export const keybindings = {
  submit: 'return',
  newline: 'ctrl+j',
  cancel: 'escape',
  clear: 'ctrl+l',
  details: 'ctrl+o',
  quit: '/quit',
} as const;

export function commandHelp(): string {
  return 'Enter submit | Ctrl+J newline | Esc cancel | Ctrl+L clear | Ctrl+O details | /help | /compact | /history | /quit';
}
