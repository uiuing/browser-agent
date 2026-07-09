import type { ComponentType } from '../contracts/perception';
import { getRole } from './aria';

/**
 * Component-type probe. This is a key differentiator vs nanobrowser, which only
 * treats native <select> as a dropdown. We recognize the popular component-library
 * widget shells (Ant Design, Element Plus, react-select, common datepickers) so the
 * adapter layer can drive them correctly.
 */
export function detectComponentType(el: Element): ComponentType {
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute('class') || '').toLowerCase();
  const role = getRole(el);
  const type = (el.getAttribute('type') || '').toLowerCase();
  const testid = (el.getAttribute('data-testid') || el.getAttribute('data-test') || '').toLowerCase();

  const hay = `${cls} ${testid}`;

  // File upload
  if (tag === 'input' && type === 'file') return 'file-upload';

  // Native selects
  if (tag === 'select') return 'native-select';

  // Textareas / contenteditable
  if (tag === 'textarea') return 'textarea';
  if (el.getAttribute('contenteditable') === 'true') return 'contenteditable';

  // Checkboxes / radios / switches
  if (tag === 'input' && type === 'checkbox') return 'checkbox';
  if (tag === 'input' && type === 'radio') return 'radio';
  if (role === 'switch' || /\bswitch\b|toggle/.test(hay)) return 'switch';

  // Datepickers (shells)
  if (
    /date-?picker|el-date|ant-picker|rc-picker|datepicker|calendar-input/.test(hay) ||
    (tag === 'input' && (type === 'date' || /date/.test(hay)))
  ) {
    return 'datepicker';
  }

  // Cascader
  if (/cascader/.test(hay)) return 'cascader';

  // Multiselect
  if (
    /multi-?select|multiselect|select--multiple|ant-select-multiple|el-select__tags|tags-input/.test(hay) ||
    (role === 'listbox' && el.getAttribute('aria-multiselectable') === 'true')
  ) {
    return 'multiselect';
  }

  // Custom select shells (Ant / Element / react-select / generic combobox)
  if (
    /ant-select|el-select|react-select|rc-select|\bselect__control\b|\bselect-selector\b|chakra-select|mantine-Select/.test(
      hay,
    ) ||
    (role === 'combobox' && tag !== 'input') ||
    ((role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') && tag === 'div')
  ) {
    return 'custom-select';
  }

  // Native text-ish inputs
  if (tag === 'input') {
    if (['text', 'email', 'tel', 'url', 'password', 'search', 'number', ''].includes(type)) return 'native-input';
    return 'native-input';
  }

  if (tag === 'a' || role === 'link') return 'link';
  if (tag === 'button' || role === 'button') return 'button';
  if (role === 'listitem' || tag === 'li') return 'listitem';

  return 'generic';
}
