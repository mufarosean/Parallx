import fs from 'fs/promises';
import path from 'path';

const REQUIRED_INSURANCE_WORKSPACE_FILES = [
  'Accident Quick Reference.md',
  'Agent Contacts.md',
  'Auto Insurance Policy.md',
  'Claims Guide.md',
  'Claims Workflow Architecture.md',
  'Vehicle Info.md',
] as const;

export async function validateInsuranceWorkspaceGroundTruth(workspacePath: string): Promise<void> {
  const missing: string[] = [];

  for (const relativePath of REQUIRED_INSURANCE_WORKSPACE_FILES) {
    const absolutePath = path.join(workspacePath, relativePath);
    const exists = await fs.stat(absolutePath).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      'Insurance AI eval requires the bundled insurance demo workspace or an equivalent corpus. Missing required files:\n'
      + missing.map((entry) => `- ${entry}`).join('\n'),
    );
  }
}