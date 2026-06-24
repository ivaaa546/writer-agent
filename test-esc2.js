import { select } from '@inquirer/prompts';
import readline from 'node:readline';

// Node's built-in keypress events aren't always active, but inquirer activates them internally.
// We can manually listen.
const p = select({ message: 'test', choices: [{value:'a'}, {value:'b'}] });

const listener = (str, key) => {
  if (key && key.name === 'escape') {
    p.cancel();
  }
};
process.stdin.on('keypress', listener);

p.then(res => console.log('Result:', res))
 .catch(err => console.log('Error:', err.name))
 .finally(() => {
   process.stdin.off('keypress', listener);
   process.exit(0);
 });
