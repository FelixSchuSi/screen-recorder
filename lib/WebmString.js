import { WebmBase } from "./WebmBase.js";
/** @extends WebmBase<Uint8Array, string> */
export class WebmString extends WebmBase {
  /**
   * @param {string} [name]
   * @param {number} [start=0]
   */
  constructor(name, start = 0) {
    super(name, start);
  }
  /**
   * @returns {string}
   */
  getType() {
    return "String";
  }
  /**
   * @returns {void}
   */
  updateBySource() {
    this.data = this.source;
  }
  /**
   * @returns {void}
   */
  updateByData() {
    this.source = this.data;
  }
  /**
   * @returns {string}
   */
  getValue() {
    let result = "";
    this.source.forEach((code) => {
      result += String.fromCharCode(code);
    });
    return result;
  }
}
