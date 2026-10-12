/**
 * Serial campaign ordering, judged only from the stubs' own records: starts
 * follow the children's stored sequence, and each start is later than the
 * previous child's completion on the system-wide monotonic clock.
 */
export function serialOrderViolations({ orderedChildIds, startRecords, completionRecords }) {
  const violations = [];
  const starts = [...startRecords].sort((left, right) => compareNs(left.monotonic_ns, right.monotonic_ns));
  starts.forEach((record, index) => {
    if (record.work_item_id !== orderedChildIds[index]) {
      violations.push(
        `start ${index + 1} was ${record.work_item_id}, expected ${orderedChildIds[index] ?? "no start"} in stored sequence order`,
      );
    }
  });
  for (let index = 1; index < starts.length; index += 1) {
    const previous = starts[index - 1];
    const completion = completionRecords.find((record) => record.agent_run_id === previous.agent_run_id);
    const current = starts[index];
    if (!completion) {
      violations.push(`${current.work_item_id} started before ${previous.work_item_id} recorded a completion`);
    } else if (compareNs(current.monotonic_ns, completion.monotonic_ns) <= 0) {
      violations.push(
        `${current.work_item_id} started at ${current.monotonic_ns} before ${previous.work_item_id} completed at ${completion.monotonic_ns}`,
      );
    }
  }
  return violations;
}

function compareNs(left, right) {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
