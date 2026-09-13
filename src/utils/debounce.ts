export function debounce(fn: () => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    cancel();
    timer = setTimeout(fn, wait);
  };
  return { schedule, cancel };
}