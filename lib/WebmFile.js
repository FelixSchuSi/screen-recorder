import { WebmContainer } from "./WebmContainer.js";
/** @extends WebmContainer */
export class WebmFile extends WebmContainer {
  /**
   * @param {Uint8Array} source
   */
  constructor(source) {
    super("File");
    this.setSource(source);
  }
  /**
   * @returns {string}
   */
  getType() {
    return "File";
  }
  /**
   * @param {string} [mimeType="video/webm"]
   * @returns {Blob}
   */
  toBlob(mimeType = "video/webm") {
    return new Blob([this.source.buffer], { type: mimeType });
  }
  /**
   * @static
   * @param {Blob} blob
   * @returns {Promise<Uint8Array>}
   */
  static blobToArray(blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result === null) {
            reject("null provided when ArrayBuffer was expected.");
            return;
          }
          if (typeof reader.result === "string") {
            reject(`string '${reader.result}' provided when ArrayBuffer was expected.`);
            return;
          }
          try {
            resolve(new Uint8Array(reader.result));
          } catch (ex) {
            reject(ex);
          }
        };
        reader.readAsArrayBuffer(blob);
      } catch (ex) {
        reject(ex);
      }
    });
  }
  /**
   * @static
   * @param {Blob} blob
   * @returns {Promise<WebmFile>}
   */
  static async fromBlob(blob) {
    const array = await WebmFile.blobToArray(blob);
    return new WebmFile(array);
  }
}
