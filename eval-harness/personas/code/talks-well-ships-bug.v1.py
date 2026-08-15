def solution(prices):
    min_price = prices[0]
    best = prices[1] - prices[0]
    for price in prices[1:]:
        best = max(best, price - min_price)
        min_price = min(min_price, price)
    return best
