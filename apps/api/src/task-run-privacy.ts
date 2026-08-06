function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type TaskRunPricingView = {
  taskType: string;
  userUuid: string | null;
  payload: unknown;
  result: unknown;
};

/**
 * Keep server-side task snapshots intact while removing secrets from every
 * response and creator pricing from collaborator-visible responses.
 */
export function sanitizeTaskRunPricingForViewer<T extends TaskRunPricingView>(
  run: T,
  viewerUserId: string | null | undefined,
): T {
  let payload = run.payload;
  if (run.taskType === "create_space" && isRecord(payload) && isRecord(payload.data)) {
    const data = { ...payload.data };
    if (Object.hasOwn(data, "gitToken")) {
      delete data.gitToken;
      payload = { ...payload, data };
    }
  }

  const isGeneration = run.taskType === "generation";
  const isBillingRetry = run.taskType === "generation.billing_retry";
  if ((!isGeneration && !isBillingRetry) || (viewerUserId && run.userUuid === viewerUserId)) {
    return payload === run.payload ? run : { ...run, payload };
  }

  if (isRecord(payload) && isRecord(payload.data)) {
    const data = { ...payload.data };
    let dataChanged = false;
    for (const key of isBillingRetry
      ? ["modelDiscount", "officialCostUsd", "amountUsd"]
      : ["modelDiscount"]) {
      if (Object.hasOwn(data, key)) {
        delete data[key];
        dataChanged = true;
      }
    }
    if (dataChanged) payload = { ...payload, data };
  }

  let result = run.result;
  if (isGeneration && isRecord(result) && Object.hasOwn(result, "billing")) {
    const nextResult = { ...result };
    delete nextResult.billing;
    result = nextResult;
  } else if (isBillingRetry && isRecord(result)) {
    const nextResult = { ...result };
    let resultChanged = false;
    for (const key of ["officialCostUsd", "amountUsd", "discountMultiplier"]) {
      if (Object.hasOwn(nextResult, key)) {
        delete nextResult[key];
        resultChanged = true;
      }
    }
    if (resultChanged) result = nextResult;
  }

  return payload === run.payload && result === run.result ? run : { ...run, payload, result };
}
