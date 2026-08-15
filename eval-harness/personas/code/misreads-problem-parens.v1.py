def solution(s):
    balance = 0
    for ch in s:
        if ch in "([{":
            balance += 1
        else:
            balance -= 1
            if balance < 0:
                return False
    return balance == 0
