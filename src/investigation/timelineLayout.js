// 仅调整时间轴黄块的显示范围，不改变证据的实际时间窗口或原有索引。
// 有交叠（或间距不足）的黄块共用一段显示区域，在相邻中心之间切开并留缝。
export function separateTimelineSpans(spans, gap = 6) {
  const items = spans.map(([left, right], index) => ({
    left, right: Math.max(left + 2, right), index,
  })).sort((a, b) => a.left - b.left || a.index - b.index);
  const result = new Array(items.length);
  let group = [], end = -Infinity;

  function flush() {
    if (!group.length) return;
    if (group.length === 1) {
      const item = group[0];
      result[item.index] = [item.left, item.right];
      return;
    }
    const start = group[0].left;
    const width = end - start;
    const count = group.length;
    // 窄屏或同一时刻有多条证据时，仍保证每段为正宽度且彼此留缝。
    const spacing = Math.min(gap, width / (count * 2 - 1));
    const minWidth = Math.min(2, (width - spacing * (count - 1)) / count);
    const center = (item) => (item.left + item.right) / 2;
    group.sort((a, b) => center(a) - center(b) || a.index - b.index);
    const sameTime = Math.abs(center(group[count - 1]) - center(group[0])) < 1e-6;
    let left = start;
    group.forEach((item, i) => {
      let right = end;
      if (i < count - 1) {
        const boundary = sameTime ? start + width * (i + 1) / count
          : (center(item) + center(group[i + 1])) / 2;
        const limit = end - (count - i - 1) * (spacing + minWidth);
        right = Math.max(left + minWidth, Math.min(limit, boundary - spacing / 2));
      }
      result[item.index] = [left, right];
      left = right + spacing;
    });
  }

  for (const item of items) {
    if (group.length && item.left - end >= gap) {
      flush();
      group = [];
      end = -Infinity;
    }
    group.push(item);
    end = Math.max(end, item.right);
  }
  flush();
  return result;
}
