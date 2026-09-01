import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { CodeLoopError } from '../shared/errors';

const SECRET_FILE = /(^|[\\/])\.env(?:\.[^\\/]+)?$/iu;
const PROTECTED_COMPONENT = /(^|[\\/])(?:\.git|\.codeloop|\.ssh|\.aws|\.azure|\.kube)([\\/]|$)/iu;
const SECRET_NAME = /(^|[\\/])(?:credentials|secrets|secret|service-account|token)\.(?:json|ya?ml|toml)$/iu;
const SECRET_EXTENSION = /\.(?:pem|key|pfx|p12)$/iu;
const SECRET_KEY_NAME = /(^|[\\/])(?:id_rsa|id_ed25519|known_hosts)$/iu;
const SYSTEM_PATH = /[\\/]Windows[\\/](?:System32|SysWOW64|WinSxS|Boot|Servicing)(?:[\\/]|$)|[\\/]Program Files(?: \(x86\))?(?:[\\/]|$)|[\\/]ProgramData(?:[\\/]|$)|[\\/]AppData[\\/](?:Local|Roaming)[\\/]Microsoft[\\/](?:Credentials|Vault)(?:[\\/]|$)/iu;

export class PathGuard {
  public readonly projectRoot: string;

  public constructor(projectRoot: string) {
    this.projectRoot = realpathSync.native(projectRoot);
  }

  public resolveInside(input: string): string {
    if (!input || input.includes('\0')) throw new CodeLoopError('PATH_DENIED', 'The path is empty or contains an invalid character.');
    const candidate = resolve(this.projectRoot, input);
    const existing = existsSync(candidate) ? realpathSync.native(candidate) : candidate;
    if (!this.isInside(existing)) throw new CodeLoopError('PATH_DENIED', 'The path is outside the project root.');
    this.rejectReparseEscape(candidate);
    if (this.isHardDenied(candidate)) throw new CodeLoopError('PATH_DENIED', 'The path is protected.');
    return candidate;
  }

  public isInside(candidate: string): boolean {
    const root = this.projectRoot.toLowerCase();
    const target = resolve(candidate).toLowerCase();
    const difference = relative(root, target);
    return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
  }

  public isHardDenied(candidate: string): boolean {
    const normalised = candidate.replaceAll('/', '\\');
    const basename = normalised.split('\\').at(-1)?.toLowerCase() ?? '';
    const envExample = basename === '.env.example';
    return (SECRET_FILE.test(normalised) && !envExample)
      || PROTECTED_COMPONENT.test(normalised)
      || SECRET_NAME.test(normalised)
      || SECRET_EXTENSION.test(normalised)
      || SECRET_KEY_NAME.test(normalised)
      || SYSTEM_PATH.test(normalised);
  }

  private rejectReparseEscape(candidate: string): void {
    let current = resolve(candidate);
    const root = this.projectRoot.toLowerCase();
    while (current.toLowerCase() !== root) {
      if (existsSync(current)) {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) {
          const target = realpathSync.native(current);
          if (!this.isInside(target)) throw new CodeLoopError('PATH_DENIED', 'The path uses a link outside the project root.');
        }
      }
      const parent = resolve(current, '..');
      if (parent === current) break;
      current = parent;
    }
  }
}
