def solution(grid):
    if not grid:
        return 0

    count = 0
    for r in range(len(grid))
        for c in range(len(grid[0])):
            if grid[r][c] == "1":
                count += 1
    return count
