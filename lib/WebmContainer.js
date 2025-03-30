/** @import { SectionKey, SectionsMap } from './sections' */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebmBase } from "./WebmBase.js";
import { sections } from "./sections.js";
import { SectionType } from "./SectionType.js";
import { WebmUint } from "./WebmUint.js";
import { WebmFloat } from "./WebmFloat.js";
import { WebmString } from "./WebmString.js";
/** @extends WebmBase<WebmContainerItem[], WebmContainerItem[]> */
export class WebmContainer extends WebmBase {
  isInfinite;
  /**
   * @public
   * @default 0
   */
  offset = 0;
  /**
   * @param {string} [name]
   * @param {boolean} [isInfinite=false]
   * @param {number} [start=0]
   */
  constructor(name, isInfinite = false, start = 0) {
    super(name, start);
    this.isInfinite = isInfinite;
  }
  /**
   * @returns {string}
   */
  getType() {
    return "Container";
  }
  /**
   * @returns {number}
   */
  readByte() {
    return this.source[this.offset++];
  }
  /**
   * @returns {number}
   */
  readUint() {
    const firstByte = this.readByte();
    const bytes = 8 - firstByte.toString(2).length;
    let value = firstByte - (1 << (7 - bytes));
    for (let i = 0; i < bytes; i++) {
      value <<= 8;
      value |= this.readByte();
    }
    return value;
  }
  /**
   * @returns {void}
   */
  updateBySource() {
    this.data = [];
    let end;
    for (this.offset = 0; this.offset < this.source.length; this.offset = end) {
      const start = this.offset;
      const id = this.readUint();
      const { name, type } = sections[id] ?? {};
      const len = this.readUint();
      end = this.source.length;
      if (len >= 0) end = Math.min(this.offset + len, end);
      const data = this.source.slice(this.offset, end);
      let section;
      switch (type) {
        case SectionType.Container:
          section = new WebmContainer(name, len < 0, start);
          break;
        case SectionType.Uint:
          section = new WebmUint(name, start);
          break;
        case SectionType.Float:
          section = new WebmFloat(name, start);
          break;
        case SectionType.String:
          section = new WebmString(name, start);
          break;
        default:
          section = new WebmBase(name, start);
          break;
      }
      section.setSource(data);
      this.data.push({
        id,
        idHex: id.toString(16),
        data: section,
      });
    }
  }
  /**
   * @param {number} x
   * @param {boolean} [draft=false]
   * @returns {void}
   */
  writeUint(x, draft = false) {
    let bytes;
    for (bytes = 1; (x < 0 || x >= 1 << (7 * bytes)) && bytes < 8; bytes++) {
      // NOOP
    }
    if (!draft) {
      for (let i = 0; i < bytes; i++) {
        this.source[this.offset + i] = (x >> (8 * (bytes - 1 - i))) & 0xff;
      }
      this.source[this.offset] &= (1 << (8 - bytes)) - 1;
      this.source[this.offset] |= 1 << (8 - bytes);
    }
    this.offset += bytes;
  }
  /**
   * @param {boolean} [draft=false]
   * @returns {number}
   */
  writeSections(draft = false) {
    this.offset = 0;
    for (let i = 0; i < this.data.length; i++) {
      const section = this.data[i],
        content = section.data.source,
        contentLength = content.length;
      this.writeUint(section.id, draft);
      this.writeUint(
        section.data instanceof WebmContainer && section.data.isInfinite
          ? -1
          : contentLength,
        draft,
      );
      if (!draft) {
        this.source.set(content, this.offset);
      }
      this.offset += contentLength;
    }
    return this.offset;
  }
  /**
   * @returns {void}
   */
  updateByData() {
    // run without accessing this.source to determine total length - need to know it to create Uint8Array
    const length = this.writeSections(true);
    this.source = new Uint8Array(length);
    // now really write data
    this.writeSections();
  }
  /**
   * @template {SectionKey} IdType
   * @param {IdType} id
   * @returns {TypeBySectionKey<IdType> | null}
   */
  getSectionById(id) {
    for (let i = 0; i < this.data.length; i++) {
      const section = this.data[i];
      if (section.id === id) {
        return section.data;
      }
    }
    return null;
  }
}
/**
 * @typedef {Object} SectionTypeMap
 * @property {WebmContainer} [SectionType.Container]
 * @property {WebmUint} [SectionType.Uint]
 * @property {WebmFloat} [SectionType.Float]
 * @property {WebmString} [SectionType.String]
 */
/**
 * @typedef {SectionsMap[IdType]["type"] extends keyof SectionTypeMap
 *     ? SectionTypeMap[SectionsMap[IdType]["type"]]
 *     : WebmBase<any, any>} TypeBySectionKey
 * @template {SectionKey} IdType
 */

/**
 * @typedef {Object} WebmContainerItem
 * @template {SectionKey} IdType
 * @property {IdType} id
 * @property {string} [idHex]
 * @property {TypeBySectionKey<IdType>} data
 */
