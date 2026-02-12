const { v4: uuidv4 } = require("uuid");
const { githubApi } = require("./github");

const { GH_OWNER, GH_REPO } = process.env;

/**
 * Create a new job branch with updated job.md
 * @param {string} jobDescription - The job description to write to job.md
 * @returns {Promise<{job_id: string, branch: string}>} - Job ID and branch name
 */
async function createJob(jobDescription) {
  const jobId = uuidv4();
  const branch = `job/${jobId}`;

  // 1) Get main branch SHA
  const mainRef = await githubApi(
    `/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/main`
  );
  const mainSha = mainRef.object.sha;

  // 2) Create new branch
  await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: mainSha,
    }),
  });

  // 3) Create logs/${jobId}/job.md with job content (NO YAML FRONT MATTER)
  const safeJobDescription = String(jobDescription ?? "");

  // If the incoming text starts with YAML front-matter markers, strip the first marker
  const sanitized = safeJobDescription.replace(/^---\s*\r?\n/, "");

  const jobMd = `# Job

**Job ID:** \`${jobId}\`

## Request
${sanitized}
`;

  await githubApi(`/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${jobId}/job.md`, {
    method: "PUT",
    body: JSON.stringify({
      message: `job: ${jobId}`,
      content: Buffer.from(jobMd, "utf8").toString("base64"),
      branch: branch,
    }),
  });

  return { job_id: jobId, branch };
}

module.exports = { createJob };
