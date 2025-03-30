/** @import { Options } from './Options.js' */
import { WebmFile } from "./WebmFile.js";
import { fixParsedWebmDuration } from "./fixParsedWebmDuration.js";
/**
 * @param {Blob} blob
 * @param {number} duration
 * @param {Options} [options]
 * @returns {Promise<Blob>}
 */
export const fixWebmDuration = async (blob, duration, options) => {
  try {
    const file = await WebmFile.fromBlob(blob);
    if (fixParsedWebmDuration(file, duration, options)) {
      return file.toBlob(blob.type);
    }
  } catch {
    // NOOP
  }
  return blob;
};
