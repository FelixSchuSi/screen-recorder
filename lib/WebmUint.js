import { WebmBase } from "./WebmBase.js";
/**
 * @param {string} hex
 * @returns {string}
 */
function padHex(hex) {
  return hex.length % 2 === 1 ? "0" + hex : hex;
}
/** @extends WebmBase<string, number> */
export class WebmUint extends WebmBase {
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
    return "Uint";
  }
  /**
   * @returns {void}
   */
  updateBySource() {
    // use hex representation of a number instead of number value
    this.data = "";
    for (let i = 0; i < this.source.length; i++) {
      const hex = this.source[i].toString(16);
      this.data += padHex(hex);
    }
  }
  /**
   * @returns {void}
   */
  updateByData() {
    const length = this.data.length / 2;
    this.source = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const hex = this.data.substring(i * 2, i * 2 + 2);
      this.source[i] = parseInt(hex, 16);
    }
  }
  /**
   * @returns {number}
   */
  getValue() {
    return parseInt(this.data, 16);
  }
  /**
   * @param {number} value
   * @returns {void}
   */
  setValue(value) {
    this.setData(padHex(value.toString(16)));
  }
}
