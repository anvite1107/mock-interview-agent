import sys
import json
import io
import traceback
from deserialize import deserialize_arg, serialize_output, TreeNode, ListNode


def emit(payload):
    """The only permitted write to real stdout — always exactly one JSON line."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main():
    real_stdout = sys.stdout

    if len(sys.argv) < 2:
        emit({"error": {"type": "runtime-error", "message": "No candidate file path provided"}})
        sys.exit(1)

    candidate_path = sys.argv[1]

    try:
        request = json.loads(sys.stdin.read())
    except Exception as e:
        emit({"error": {"type": "runtime-error", "message": f"Failed to parse stdin: {e}"}})
        sys.exit(1)

    raw_input = request["input"]
    input_structures = request.get("inputStructures")
    output_structure = request.get("outputStructure", "flat")

    # Namespace candidate code executes in: pre-populated with typing imports
    # and TreeNode/ListNode, matching real interview platforms where these
    # are provided rather than defined by the candidate.
    namespace = {}
    preamble = "from typing import List, Optional, Dict, Tuple, Set, Any\n"
    exec(compile(preamble, "<preamble>", "exec"), namespace)
    namespace["TreeNode"] = TreeNode
    namespace["ListNode"] = ListNode

    captured_stdout = io.StringIO()
    sys.stdout = captured_stdout

    try:
        with open(candidate_path, "r") as f:
            candidate_source = f.read()
        exec(compile(candidate_source, candidate_path, "exec"), namespace)

        if "solution" not in namespace:
            sys.stdout = real_stdout
            emit({"error": {"type": "runtime-error", "message": "No 'solution' function defined"}})
            sys.exit(1)

        solution = namespace["solution"]

        args = (
            [deserialize_arg(v, input_structures[i] if i < len(input_structures) else "flat")
             for i, v in enumerate(raw_input)]
            if input_structures else raw_input
        )

        result = solution(*args)
        serialized = serialize_output(result, output_structure)

    except Exception:
        sys.stdout = real_stdout
        emit({
            "error": {"type": "runtime-error", "message": traceback.format_exc()},
            "candidateStdout": captured_stdout.getvalue(),
        })
        sys.exit(1)

    sys.stdout = real_stdout
    emit({"output": serialized, "candidateStdout": captured_stdout.getvalue()})


if __name__ == "__main__":
    main()