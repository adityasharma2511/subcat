// This is a shim for web and Android where the tab bar is generally opaque.
export default () => null;

export function useBottomTabOverflow() {
  return 0;
}
