import type { CodeLoopConfig } from '../config/config';
import { PermissionPolicy } from '../permissions/permission-policy';
import { PathGuard } from '../permissions/path-guard';
import { createShellTool } from './shell';
import { editTool } from './edit';
import { listTool } from './list';
import { createReadTool } from './read';
import { ToolRegistry } from './registry';
import { writeTool } from './write';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';

export function createBuiltinRegistry(config: CodeLoopConfig, processRunner: ProcessRunner = new NativeProcessRunner()): { registry: ToolRegistry; pathGuard: PathGuard; permissionPolicy: PermissionPolicy } {
  const pathGuard = new PathGuard(config.projectRoot);
  const permissionPolicy = new PermissionPolicy(pathGuard);
  const registry = new ToolRegistry();
  registry.register(createReadTool(config));
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(listTool);
  registry.register(createShellTool(config, processRunner));
  return { registry, pathGuard, permissionPolicy };
}
