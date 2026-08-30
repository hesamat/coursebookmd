/**
 * local-assets-controller.js — Local image/asset loading for the live
 * preview and export, composed by app.js via injected dependencies.
 * Controllers never import each other; cross-controller calls are routed
 * through deps.
 */

export function createLocalAssetsController(deps) {
  const { state, readFileFromDirectory } = deps;

  /**
   * Load a local file from the active store (FileSystemDirectoryHandle or
   * webkitdirectory file map) for a relative path.
   * @param {string} relPath
   * @returns {Promise<File>}
   */
  async function getLocalFile(relPath) {
    if (state.localFileStore.dirHandle) {
      const { file } = await readFileFromDirectory(
        state.localFileStore.dirHandle,
        relPath,
      );
      return file;
    }
    if (state.localFileStore.fileMap) {
      const file = state.localFileStore.fileMap.get(relPath);
      if (file) return file;
      const lowerFile = state.localFileStore.fileMapLower?.get(relPath.toLowerCase());
      if (lowerFile) return lowerFile;
      console.warn("File not found in selected folder:", relPath);
      throw new Error("File not found in selected folder.");
    }
    throw new Error("No local file store available");
  }

  /**
   * Replace local image paths with blob URLs for sections loaded from the
   * file system. Falls back to the original (pre-resolution) src if the
   * resolved path is not found, so images stored at the coursebook root can
   * still be found from chapters.
   * @param {HTMLElement} container
   */
  async function resolveLocalImages(container) {
    if (!state.localFileStore) return;

    for (const img of container.querySelectorAll("img")) {
      const resolved = img.getAttribute("src") || "";
      const original = img.dataset.originalSrc || resolved;
      if (!resolved || resolved.startsWith("data:") || resolved.startsWith("blob:")) {
        continue;
      }
      if (
        /^https?:/.test(resolved) ||
        resolved.startsWith("//") ||
        resolved.startsWith("/")
      ) {
        continue;
      }

      const tryRead = async (relPath) => {
        const file = await getLocalFile(relPath);
        const url = URL.createObjectURL(file);
        state.localImageUrls.push(url);
        img.src = url;
        img.removeAttribute("data-original-src");
      };

      try {
        await tryRead(resolved);
      } catch {
        // If the original src was a bare path (not ./ or ../) and differs from
        // the resolved path, also try the original at the coursebook root.
        if (
          original !== resolved &&
          !original.startsWith("./") &&
          !original.startsWith("../") &&
          !/^https?:/.test(original) &&
          !original.startsWith("//") &&
          !original.startsWith("/") &&
          !original.startsWith("data:")
        ) {
          try {
            await tryRead(original);
          } catch {
            // leave broken image as-is
          }
        }
      }
    }
  }

  /**
   * Convert a File object to a base64 data URI for export.
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function fileToDataUri(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const type = file.type || "application/octet-stream";
    return `data:${type};base64,${globalThis.btoa(binary)}`;
  }

  /**
   * Load a local image asset for export, converting it to a data URI.
   * Throws if the file is not available in the active local file store.
   * @param {string} relPath
   * @returns {Promise<string>}
   */
  async function resolveAsset(relPath) {
    const file = await getLocalFile(relPath);
    return fileToDataUri(file);
  }

  return { resolveLocalImages, resolveAsset };
}
