/**
 * fs.js — File System Access helpers for reading coursebook files from a
 * user-selected directory. Pure filesystem logic, no app state.
 */

/**
 * Find a directory/file entry by case-insensitive name match. Works around
 * filesystems where the on-disk casing differs from the coursebook.md paths.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} name
 * @param {"file"|"directory"} kind
 * @returns {Promise<string|null>} The entry's actual name, or null.
 */
export async function findEntryName(dirHandle, name, kind) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === kind && entry.name.toLowerCase() === name.toLowerCase()) {
      return entry.name;
    }
  }
  return null;
}

/**
 * Recursively read a file from a directory handle given a relative path
 * like "chapters/01-intro.md".
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath
 * @param {{quiet?: boolean}} [options] - Suppress the "not found" warnings
 *   when the caller treats absence as an expected, handled outcome.
 * @returns {Promise<{file: File, fileHandle: FileSystemFileHandle}>}
 */
export async function readFileFromDirectory(
  dirHandle,
  relativePath,
  { quiet = false } = {},
) {
  const warn = (message) => {
    if (!quiet) console.warn(message, relativePath);
  };
  const parts = relativePath.split("/").filter(Boolean);
  let current = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts[i];
    try {
      current = await current.getDirectoryHandle(name);
    } catch {
      const real = await findEntryName(current, name, "directory");
      if (!real) {
        warn("Directory not found in selected folder:");
        throw new Error("Directory not found in selected folder.");
      }
      current = await current.getDirectoryHandle(real);
    }
  }
  const fileName = parts[parts.length - 1];
  let fileHandle;
  try {
    fileHandle = await current.getFileHandle(fileName);
  } catch {
    const real = await findEntryName(current, fileName, "file");
    if (!real) {
      warn("File not found in selected folder:");
      throw new Error("File not found in selected folder.");
    }
    fileHandle = await current.getFileHandle(real);
  }
  const file = await fileHandle.getFile();
  return { file, fileHandle };
}
