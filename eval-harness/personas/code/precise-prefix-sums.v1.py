def solution(nums, k):
    counts = {0: 1}
    running = 0
    total = 0
    for n in nums:
        running += n
        total += counts.get(running - k, 0)
        counts[running] = counts.get(running, 0) + 1
    return total
