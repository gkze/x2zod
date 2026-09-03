const sortBefore = -1;

export const compareCodeUnits = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? sortBefore : 1;
};
