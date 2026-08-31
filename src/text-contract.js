const TEXT_ACTION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", minLength: 1 },
    changes: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
    unclear: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
    logicIssues: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
    medicalIssues: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
  },
  required: ["text", "changes", "unclear", "logicIssues", "medicalIssues"],
};

module.exports = { TEXT_ACTION_OUTPUT_SCHEMA };
