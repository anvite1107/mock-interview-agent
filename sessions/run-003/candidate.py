def solution(head, k):
    if head is None or k <= 1:
        return head

    length = 0
    node = head
    while node is not None:
        length += 1
        node = node.next

    dummy = ListNode(0, head)
    group_prev = dummy

    while length >= k:
        prev = None
        curr = group_prev.next
        group_tail = curr
        for _ in range(k):
            nxt = curr.next
            curr.next = prev
            prev = curr
            curr = nxt
        group_prev.next = prev
        group_tail.next = curr
        group_prev = group_tail
        length -= k

    return dummy.next
