def solution(prices):
    best = 0
    for i in range(len(prices)):
        for j in range(i + 1, len(prices)):
            if prices[i] - prices[j] > best:
                best = prices[i] - prices[j]
    return best
