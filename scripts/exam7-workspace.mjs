import fs from 'node:fs';
import path from 'node:path';

export const EXAM7_WORKSPACE = 'C:/Users/mchit/OneDrive/Documents/Actuarial Science/Exams/Exam 7 - April 2026';

const REQUIRED_EXAM7_FILES = [
  'Exam 7 Reading List.pdf',
  'Study Guide - CAS Exam 7 RF.pdf',
  'Source Material/Mack_Chain Ladder.pdf',
  'Practice Problems/Mack - Benktander.xlsx',
  'RF Guides/Brosius.pdf',
  'RF Guides/Clark.pdf',
  'RF Guides/Friedland.pdf',
  'RF Guides/Hurlimann.pdf',
  'RF Guides/MackBenktander.pdf',
  'RF Guides/MackChainLadder.pdf',
  'RF Guides/Marshall.pdf',
  'RF Guides/Meyers.pdf',
  'RF Guides/Sahasrabuddhe.pdf',
  'RF Guides/Shapland.pdf',
  'RF Guides/Siewert.pdf',
  'RF Guides/TaylorMcGuire.pdf',
  'RF Guides/TengPerkins.pdf',
  'RF Guides/VenterFactors.pdf',
  'RF Guides/Verrall.pdf',
  'Source Material/Clark.pdf',
];

export function getMissingExam7BenchmarkFiles(workspacePath = EXAM7_WORKSPACE) {
  const normalizedWorkspace = path.resolve(workspacePath);

  if (!fs.existsSync(normalizedWorkspace)) {
    return {
      workspaceExists: false,
      missingFiles: REQUIRED_EXAM7_FILES.slice(),
    };
  }

  const missingFiles = REQUIRED_EXAM7_FILES.filter((relativePath) => !fs.existsSync(path.join(normalizedWorkspace, relativePath)));
  return {
    workspaceExists: true,
    missingFiles,
  };
}

export function formatExam7MissingFilesMessage(workspacePath = EXAM7_WORKSPACE) {
  const { workspaceExists, missingFiles } = getMissingExam7BenchmarkFiles(workspacePath);

  if (!workspaceExists) {
    return `Workspace not found: ${path.resolve(workspacePath)}`;
  }

  if (missingFiles.length === 0) {
    return '';
  }

  return `Workspace missing ${missingFiles.length} required benchmark file(s): ${missingFiles.join(', ')}`;
}