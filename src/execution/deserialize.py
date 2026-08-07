class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


def build_tree(arr):
    """
    Builds a binary tree from a level-order array with None for missing children.
    e.g. [3, 9, 20, None, None, 15, 7] -> TreeNode structure
    """
    if not arr or arr[0] is None:
        return None

    root = TreeNode(arr[0])
    queue = [root]
    i = 1

    while queue and i < len(arr):
        node = queue.pop(0)

        if i < len(arr):
            if arr[i] is not None:
                node.left = TreeNode(arr[i])
                queue.append(node.left)
            i += 1

        if i < len(arr):
            if arr[i] is not None:
                node.right = TreeNode(arr[i])
                queue.append(node.right)
            i += 1

    return root


def tree_to_array(root):
    """
    Serializes a binary tree back to level-order array with None for missing children.
    Trims trailing None values to match LeetCode-style output.
    """
    if root is None:
        return []

    result = []
    queue = [root]

    while queue:
        node = queue.pop(0)
        if node is None:
            result.append(None)
        else:
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)

    while result and result[-1] is None:
        result.pop()

    return result


def build_linked_list(arr):
    """
    Builds a singly linked list from a flat array.
    e.g. [1, 2, 3] -> ListNode(1) -> ListNode(2) -> ListNode(3)
    """
    if not arr:
        return None

    head = ListNode(arr[0])
    current = head
    for val in arr[1:]:
        current.next = ListNode(val)
        current = current.next

    return head


def linked_list_to_array(head):
    """
    Serializes a linked list back to a flat array.
    """
    result = []
    current = head
    while current is not None:
        result.append(current.val)
        current = current.next
    return result


def deserialize_arg(value, structure):
    """
    Deserializes a single argument based on its declared structure type.
    """
    if structure == "tree":
        return build_tree(value)
    elif structure == "linked-list":
        return build_linked_list(value)
    else:  # "flat" or unspecified
        return value


def serialize_output(value, structure):
    """
    Serializes a return value back to JSON-safe form based on its declared structure type.
    """
    if structure == "tree":
        return tree_to_array(value)
    elif structure == "linked-list":
        return linked_list_to_array(value)
    else:  # "flat" or unspecified
        return value