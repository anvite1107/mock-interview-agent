def solution(s):
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    return len(counts)
