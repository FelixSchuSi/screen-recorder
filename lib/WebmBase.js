/**
 * @abstract
 * @class
 * @template DataT, ValueT
 *
 * @typeparam DataT
 * @typeparam ValueT
 */
export class WebmBase {
  name;
  start;
  /**
   * @public
   */
  source;
  /**
   * @public
   */
  data;
  /**
   * @protected
   * @param {string} [name="Unknown"]
   * @param {number} [start=0]
   */
  constructor(name = "Unknown", start = 0) {
    this.name = name;
    this.start = start;
  }
  /**
   * @returns {string}
   */
  getType() {
    return "Unknown";
  }
  /**
   * @returns {void}
   */
  updateBySource() {
    // NOOP
  }
  /**
   * @param {Uint8Array} source
   * @returns {void}
   */
  setSource(source) {
    this.source = source;
    this.updateBySource();
  }
  /**
   * @returns {void}
   */
  updateByData() {
    // NOOP
  }
  /**
   * @param {DataT} data
   * @returns {void}
   */
  setData(data) {
    this.data = data;
    this.updateByData();
  }
  /**
   * @returns {ValueT}
   */
  getValue() {
    return this.data;
  }
  /**
   * @param {ValueT} value
   * @returns {void}
   */
  setValue(value) {
    // @ts-ignore
    this.setData(value);
  }
}
