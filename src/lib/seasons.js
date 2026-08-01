export function getSeasonId(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  if (year === 2026 && month === 5) return "May 2026";
  const pairs = [
    [6,7,"Jun-Jul"], [8,9,"Aug-Sep"], [10,11,"Oct-Nov"]
  ];
  const fullYearPairs = [
    [2,3,"Feb-Mar"], [4,5,"Apr-May"], [6,7,"Jun-Jul"],
    [8,9,"Aug-Sep"], [10,11,"Oct-Nov"]
  ];
  const decJanCheck = (month === 12 || month === 1);
  if (decJanCheck) {
    const y = month === 12 ? year : year - 1;
    return `Dec-Jan ${y}-${String(y+1).slice(-2)}`;
  }
  if (year === 2026) {
    const pair = pairs.find(([s,e]) => month >= s && month <= e);
    if (pair) return `${pair[2]} ${year}`;
  }
  const pair = fullYearPairs.find(([s,e]) => month >= s && month <= e);
  if (pair) return `${pair[2]} ${year}`;
  return `${year}`;
}

export function getSeasonDateRange(seasonId) {
  if (seasonId === "May 2026") return { start: new Date(2026, 4, 1), end: new Date(2026, 4, 31, 23, 59, 59) };
  if (seasonId.startsWith("Dec-Jan")) {
    const parts = seasonId.split(" ");
    const years = parts[1].split("-");
    const y1 = parseInt(years[0]);
    const y2 = 2000 + parseInt(years[1]);
    return { start: new Date(y1, 11, 1), end: new Date(y2, 0, 31, 23, 59, 59) };
  }
  const monthMap = {
    "Jun-Jul": [5, 6], "Aug-Sep": [7, 8], "Oct-Nov": [9, 10],
    "Feb-Mar": [1, 2], "Apr-May": [3, 4]
  };
  const parts = seasonId.split(" ");
  const label = parts[0];
  const year = parseInt(parts[1]);
  const [startM, endM] = monthMap[label];
  return { start: new Date(year, startM, 1), end: new Date(year, endM + 1, 0, 23, 59, 59) };
}

export function getSeasonNumber(seasonId) {
  if (seasonId === "May 2026") return 0;
  if (seasonId === "Jun-Jul 2026") return 1;
  if (seasonId === "Aug-Sep 2026") return 2;
  if (seasonId === "Oct-Nov 2026") return 3;
  if (seasonId === "Dec-Jan 2026-27") return 4;
  const order = ["Feb-Mar", "Apr-May", "Jun-Jul", "Aug-Sep", "Oct-Nov"];
  const decJanPattern = /^Dec-Jan (\d{4})-(\d{2})$/;
  const decJanMatch = seasonId.match(decJanPattern);
  if (decJanMatch) {
    const y1 = parseInt(decJanMatch[1]);
    if (y1 < 2026) return null;
    const yearsAfter2026 = y1 - 2026;
    return 4 + (yearsAfter2026 * 6);
  }
  const parts = seasonId.split(" ");
  const label = parts[0];
  const year = parseInt(parts[1]);
  if (isNaN(year)) return null;
  const idx = order.indexOf(label);
  if (idx === -1) return null;
  if (year === 2027) return 5 + idx;
  if (year > 2027) {
    const yearsAfter2027 = year - 2027;
    return 5 + (yearsAfter2027 * 6) + idx;
  }
  return null;
}
