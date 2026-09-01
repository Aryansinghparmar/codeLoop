import React, { useState } from 'react';
import { Box, Text, useInput, render } from 'ink';
import { commandHelp } from '../keybindings';

export interface InkAppProps {
  onSubmit: (prompt: string) => Promise<string>;
  onExit?: () => void;
}

export function InkApp({ onSubmit, onExit }: InkAppProps): React.ReactElement {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState(commandHelp());
  const [busy, setBusy] = useState(false);

  useInput((value, key) => {
    if (key.escape) {
      setBusy(false);
      setInput('');
      return;
    }
    if (key.ctrl && value === 'c') {
      if (busy) setBusy(false);
      else onExit?.();
      return;
    }
    if (key.return) {
      const prompt = input.trim();
      if (!prompt || busy) return;
      setInput('');
      setBusy(true);
      void onSubmit(prompt).then(setOutput).finally(() => setBusy(false));
      return;
    }
    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && value) setInput((current) => current + value);
  });

  return <Box flexDirection="column" padding={1}>
    <Text color="cyan">CodeLoop {busy ? '(working)' : ''}</Text>
    <Text>{output}</Text>
    <Text color="green">&gt; {input}</Text>
  </Box>;
}

export function startInkApp(props: InkAppProps): void {
  render(<InkApp {...props} />);
}
