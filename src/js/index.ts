console.debug("javscript loaded");

import { createCourseSheet, getCourseName } from "./course_sheet";
import { Archive } from "@obsidize/tar-browserify";
import { v4 as uuidv4 } from 'uuid';
import { gzip, ungzip } from "pako";
import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import "../css/index.css";

// TODO list:
// Handle INVISIBLE_CONTAINERs better in sectioning. (or at all)

const default_checkboxes: { [key: string]: boolean | number } = {
  just_spreadsheet: false,
  just_test: false,
  lock: false,
  unlock: false,
  keep_locking: true,
  require: false,
  optional: false,
  keep_req: true,
  no_scrub: false,
  scrub_ok: false,
  keep_scrub: true,
  section_per_te: false,
  section_per_page: false,
  keep_sectioning: true,
  display_one: false,
  display_all: false,
  display_no_change: true,
  num_attempts: -1,
  num_attempts_no_change: true,
  pass_percent: -1,
  pass_percent_no_change: true,
  spreadsheet: true,
  clean: false,
  dont_clean: true,
};

const human_readable_options: { [key: string]: string } = {
  clean: "Clean course",
  download_new_course: "Output a new course",
  lock_unlock: "Locking",
  required_optional: "Requirement",
  scrubbing: "Scrubbing",
  section_scope: "Sectioning",
  spreadsheet: "Include course spreadsheet",
  test: "Testing",
};

const progress_stage: { [key: string]: number } = {
  "Starting": 0,
  "Getting options": 5,
  "Loading file": 10,
  "Expanding file": 20,
  "Extracting data": 30,
  "Parsing JSON": 55,
  "Processing sections": 60,
  "Cleaning course": 65,
  "Assembling files": 70,
  "Writing file": 75,
  "Download": 100,
}

/**
 * This is our "main" function.
 * Waits until the page loads to run, clears some interface elements,
 * then sets up listeners for the file input and go button.
 */
document.addEventListener("DOMContentLoaded", () => {
  console.debug("DOM loaded");
  updateStatus("Starting");

  let input_file: File;

  makeConfirmationDialog();

  // Explicitly reset some of the interface in case the user reloads.
  const go_button = document.getElementById("go");

  for (let option in default_checkboxes) {
    let element = document.getElementById(option) as HTMLInputElement;
    if (element) {
      element.checked = !!default_checkboxes[option];
    } else {
      console.debug("Could not find element with id=", option);
    }
  }
  const file_input_element = document.getElementById(
    "input_tarball"
  ) as HTMLInputElement;
  if (!go_button || !file_input_element) {
    console.error("Missing some basic HTML - check the index.html file");
    return;
  }
  file_input_element.value = "";

  // Any time a form control is changed, update the settings summaries
  updateOptionSummary();
  const form_controls = document.querySelectorAll("input, select");
  form_controls.forEach((e) => {
    e.addEventListener("change", () => {
      updateOptionSummary();
    });
  });

  // When we have a file, enable the go button
  file_input_element.addEventListener("change", (event) => {
    input_file = getInputFile(event);
    go_button.removeAttribute("disabled");
  });

  // When they glick the go button, flow passes to the confirmation dialog
  go_button?.addEventListener("click", () => {
    console.debug("Go button clicked");
    if (!input_file) {
      console.error("No file uploaded");
    } else {
      updateConfirmationDialog(input_file);
    }
  });
});

/**
 * Gets the file from the input element
 *
 * @param event The event that triggered this function
 * @returns The file supplied by the user
 */
function getInputFile(event: Event): File {
  const elem = event.target as HTMLInputElement;
  if (!elem.files) {
    console.error("Could not find the file");
    return new File([], "");
  }
  if (elem.files.length === 0) {
    console.error("No file uploaded");
    return new File([], "");
  }
  console.debug(elem.files[0].name);
  console.debug(elem.files[0].constructor.name);
  return elem.files[0];
}

/**
 * Reads the form to get options for how to handle the course.
 * The options object looks like this:\
 * { \
 *  lock_unlock: "lock" | "unlock" | "no_change",\
 *  required_optional: "require" | "optional" | "no_change",\
 *  scrubbing: "disable" | "enable" | "no_change",\
 *  section_scope: "section_per_te" | "section_per_page" | "no_change",\
 *  clean: boolean,\
 *  spreadsheet: boolean (are we making a spreadsheet) \
 * }
 *
 * @returns The options from the form
 */
function getOptions(): {
  download_new_course: boolean;
  lock_unlock: string;
  required_optional: string;
  scrubbing: string;
  section_scope: string;
  qset_display: string;
  pass_percent: number;
  pass_percent_no_change: boolean;
  num_attempts: number;
  num_attempts_no_change: boolean;
  show_answers: string;
  clean: boolean;
  spreadsheet: boolean;
  test: boolean;
} {
  let download_new_course = true;
  let just_test_value = false;

  // Get the options from the lock_unlock radio buttons
  let lock_unlock = document.querySelector(
    'input[name="lock_unlock"]:checked'
  ) as HTMLInputElement;
  let lock_unlock_value = lock_unlock.value;

  // Get the options from the required_optional radio buttons
  let required_optional = document.querySelector(
    'input[name="req_opt"]:checked'
  ) as HTMLInputElement;
  let required_optional_value = required_optional.value;

  // Can learners scrub through videos?
  let scrubbing = document.querySelector(
    'input[name="scrubbing"]:checked'
  ) as HTMLInputElement;
  let scrubbing_value = scrubbing.value;

  // Are we sectioning by TE, by page, or no change?
  let section_scope = document.querySelector(
    'input[name="sectioning"]:checked'
  ) as HTMLInputElement;
  let section_scope_value = section_scope.value;

  // How many attempts are allowed?
  let qset_display = document.querySelector(
    'input[name="qset_display"]:checked'
  ) as HTMLInputElement;
  let qset_display_value = qset_display.value;

  // What's the minimum passing percentage?
  let pass_percent_no_change = true;
  let pass_percent = document.getElementById("pass_percent") as HTMLInputElement;
  let pass_percent_temp = pass_percent.value;
  let pass_percent_value = -1; // Default: No passing percentage required.
  // Strip out % signs
  if (pass_percent_temp.endsWith("%")) {
    pass_percent_temp = pass_percent_temp.slice(0, -1);
  }
  pass_percent_value = Number(pass_percent_temp);
  if (isNaN(pass_percent_value) || pass_percent_temp === "") {
    // We've been passed a non-numeric value, so treat it as "no change"
    pass_percent_value = -1;
  } else {
    pass_percent_no_change = false;
  }

  // How many attempts are allowed?
  let num_attempts_no_change = true;
  let num_attempts = document.getElementById("num_attempts") as HTMLInputElement;
  let num_attempts_value = Number(num_attempts.value);
  // If we're passed any non-blank string, treat it as "no change"
  if (isNaN(num_attempts_value) || num_attempts.value === "") {
    num_attempts_value = -1;
  } else {
    num_attempts_no_change = false;
  }

  // When should we show the answers?
  let show_answers = document.querySelector(
    'input[name="show_answers"]:checked'
  ) as HTMLInputElement;
  let show_answers_value = show_answers.value;

  // Get the clean checkbox
  let clean = document.getElementById("clean") as HTMLInputElement;
  let clean_value = clean.checked;

  // Include course spreadsheet?
  let include_course_spreadsheet = document.getElementById(
    "spreadsheet"
  ) as HTMLInputElement;
  let include_course_spreadsheet_value = include_course_spreadsheet.checked;

  // Sometimes you just want the course spreadsheet and not to do any operations on it.
  let just_spreadsheet = document.getElementById(
    "just_spreadsheet"
  ) as HTMLInputElement;
  let just_test = document.getElementById("just_test") as HTMLInputElement;
  if (just_spreadsheet.checked || just_test.checked) {
    download_new_course = false;
    lock_unlock_value = "no_change";
    required_optional_value = "no_change";
    scrubbing_value = "no_change";
    section_scope_value = "no_change";
    qset_display_value = "no_change";
    pass_percent_value = -1;
    pass_percent_no_change = true;
    num_attempts_value = -1;
    num_attempts_no_change = true;
    show_answers_value = "no_change";
    clean_value = false;
    include_course_spreadsheet_value = true;
    just_test_value = just_test.checked;
  }

  let options = {
    download_new_course: download_new_course,
    lock_unlock: lock_unlock_value,
    required_optional: required_optional_value,
    scrubbing: scrubbing_value,
    section_scope: section_scope_value,
    qset_display: qset_display_value,
    pass_percent: pass_percent_value,
    pass_percent_no_change: pass_percent_no_change,
    num_attempts: num_attempts_value,
    num_attempts_no_change: num_attempts_no_change,
    show_answers: show_answers_value,
    clean: clean_value,
    spreadsheet: include_course_spreadsheet_value,
    test: just_test_value,
  };
  return options;
}

/**
 * Updates the summary of options based on the form
 *
 * @returns
 */
function updateOptionSummary(): void {
  let options = getOptions();
  let access_span = document.getElementById("access-details");
  let section_span = document.getElementById("section-details");
  let qset_span = document.getElementById("qset-details");
  let output_span = document.getElementById("output-details");
  if (!access_span || !section_span || !output_span || !qset_span) {
    console.error("Could not find one of the details spans");
    return;
  }

  // Clear the existing set of summaries.
  access_span.textContent = "";
  section_span.textContent = "";
  output_span.textContent = "";
  qset_span.textContent = "";

  let access_options = "Locking: ";
  if (options.lock_unlock === "lock") {
    access_options += "<span class='changed-setting'>lock</span>, ";
  } else if (options.lock_unlock === "unlock") {
    access_options += "<span class='changed-setting'>unlock</span>, ";
  } else {
    access_options += "no change, ";
  }
  access_options += "Requirement: ";
  if (options.required_optional === "require") {
    access_options += "<span class='changed-setting'>required</span>";
  } else if (options.required_optional === "optional") {
    access_options += "<span class='changed-setting'>optional</span>";
  } else {
    access_options += "no change";
  }
  access_options += ", Scrubbing: ";
  if (options.scrubbing === "disable") {
    access_options += "<span class='changed-setting'>disable</span>";
  } else if (options.scrubbing === "enable") {
    access_options += "<span class='changed-setting'>enable</span>";
  } else {
    access_options += "no change";
  }
  access_span.innerHTML = access_options;

  let section_options = "Scope: ";
  if (options.section_scope === "section_per_te") {
    section_options +=
      "<span class='changed-setting'>one section per TE</span>, ";
  } else if (options.section_scope === "section_per_page") {
    section_options +=
      "<span class='changed-setting'>one section per page</span>, ";
  } else {
    section_options += "no change";
  }
  section_span.innerHTML = section_options;

  let qset_options = "Display: ";
  if (options.qset_display === "display_one") {
    qset_options +=
      "<span class='changed-setting'>one question at a time</span>, ";
  } else if (options.qset_display === "display_all") {
    qset_options +=
      "<span class='changed-setting'>all questions at once</span>, ";
  } else {
    qset_options += "no change";
  }

  // Numerical things take a little extra checking.
  console.log(options.pass_percent);
  qset_options += ", # Attempts: ";
  if (options.num_attempts_no_change) {
    qset_options += "no change";
  } else if (options.num_attempts <= 0 || isNaN(Number(options.num_attempts))) {
    qset_options += "<span class='changed-setting'>unlimited</span>";
  } else if (options.num_attempts > 10) {
    qset_options += "<span class='bad-setting'>" + String(options.num_attempts) + "</span>";
  }
  else {
    qset_options += "<span class='changed-setting'>" + String(options.num_attempts) + "</span>";
  }
  qset_options += ", Passing: ";
  if (options.pass_percent_no_change) {
    qset_options += "no change";
  } else if (options.pass_percent <= 0 || isNaN(Number(options.pass_percent))) {
    qset_options += "<span class='changed-setting'>no minimum</span>";
  } else if (options.pass_percent > 100 || options.pass_percent < 0) {
    qset_options += "<span class='bad-setting'>" + String(options.pass_percent) + "%</span>";
  }
  else {
    qset_options += "<span class='changed-setting'>" + String(options.pass_percent) + "%</span>";
  }

  qset_options += ", Show answers: ";
  if (options.show_answers === "show_when_submitted") {
    qset_options += "<span class='changed-setting'>on submission</span>";
  } else if (options.show_answers === "show_after_attempts") {
    qset_options += "<span class='changed-setting'>after all attempts</span>";
  } else if (options.show_answers === "show_never") {
    qset_options += "<span class='changed-setting'>never</span>";
  } else {
    qset_options += "no change";
  }
  qset_span.innerHTML = qset_options;


  // qset_display: string;
  // pass_percent: number;
  // num_attempts: number;
  // show_answers: string;

  let output_options = "Output: ";
  if (options.clean) {
    output_options += "<span class='changed-setting'>Clean course</span>, ";
  }
  if (options.spreadsheet) {
    output_options += "Include course spreadsheet";
  } else {
    output_options += "<span class='changed-setting'>No spreadsheet</span>";
  }
  output_span.innerHTML = output_options;
}

/**
 * Update the "Working" button to show what stage we're in.
 */
async function updateStatus(stage: string) {
  let progress_container = document.getElementById("progress_container");
  let progress_bar = document.getElementById("progress_bar");
  let status_text = document.getElementById("processing_status");

  if (!progress_container || !progress_bar || !status_text) {
    console.error("Could not find the progress bar or status text");
    return;
  }

  status_text.innerText = String(stage);
  progress_container.setAttribute("aria-valuenow", String(progress_stage[stage]));
  progress_bar.style.width = String(progress_stage[stage]) + "%";
  console.debug(stage + " (" + progress_stage[stage] + "%)");

  // If we're done, make the progress bar solid.
  if (progress_stage[stage] === 100) {
    progress_bar.classList.remove("progress-bar-animated");
    progress_bar.classList.remove("progress-bar-striped");
  }

  // Why do I have to do this? I think it might be something related to
  // the animation delay for Bootstrap. Without this, the progress
  // bar and text can sometimes skip updates. The code would run faster
  // without this, but honestly not by a lot so it doesn't bother me much.
  // console.debug("500ms break");
  await sleep(500);
}

/**
 * If someone asks to process a 1GB file we should probably warn them.
 * Updated by updateConfirmationDialog()
 *
 * @returns
 */
function makeConfirmationDialog(): void {
  let modal_container = document.createElement("div");
  modal_container.id = "confirmation_dialog_container";
  modal_container.classList.add("modal");
  modal_container.setAttribute("tabindex", "-1");
  modal_container.setAttribute("aria-labelledby", "confirmation_header");
  let modal_dialog = document.createElement("div");
  modal_dialog.classList.add("modal-dialog");
  modal_dialog.classList.add("modal-dialog-centered");
  let modal_content = document.createElement("div");
  modal_content.classList.add("modal-content");

  let modal_header = document.createElement("div");
  modal_header.id = "confirmation_header";
  modal_header.classList.add("modal-header");
  let h2 = document.createElement("h2");
  h2.id = "confirmation_header_text";
  h2.innerText = "Confirm";
  modal_header.appendChild(h2);
  modal_content.appendChild(modal_header);

  let modal_body = document.createElement("div");
  modal_body.id = "confirmation_dialog";
  modal_body.classList.add("modal-body");
  modal_content.appendChild(modal_body);

  let dialog_footer = document.createElement("div");
  dialog_footer.classList.add("modal-footer");
  let close_button = document.createElement("button");
  close_button.id = "close_confirmation";
  close_button.innerText = "Cancel";
  close_button.setAttribute("data-bs-dismiss", "modal");
  close_button.classList.add("btn");
  close_button.classList.add("btn-secondary");
  let confirm_button = document.createElement("button");
  confirm_button.id = "confirm";
  confirm_button.innerText = "Confirm";
  confirm_button.setAttribute("data-bs-dismiss", "modal");
  confirm_button.classList.add("btn");
  confirm_button.classList.add("btn-primary");

  dialog_footer.appendChild(close_button);
  dialog_footer.appendChild(confirm_button);
  modal_content.appendChild(dialog_footer);

  modal_dialog.appendChild(modal_content);
  modal_container.appendChild(modal_dialog);
  document.body.appendChild(modal_container);

  confirm_button.addEventListener("click", () => {
    processFile();
  });
}

/**
 * Keeps the confirmation dialog updated
 *
 * @param input_file
 * @returns
 */
function updateConfirmationDialog(input_file: File): void {
  // Convert size and options to human readable format
  // This jumps through a weird hoop to make a reasonable number of sig figs
  let sillybytes = Math.round((input_file.size / 1024 / 1024) * 100);
  let megabytes = String(sillybytes / 100) + " MB";

  let options = getOptions();
  let option_string = "<ul>";
  let option_list: string[] = [];

  Object.keys(options).forEach((e, i) =>
    option_list.push(
      String(
        "<strong>" +
        human_readable_options[e] +
        ":</strong> " +
        options[e as keyof object]
      )
    )
  );
  option_list.forEach((e, i) => (option_string += `<li>${e}</li>`));
  option_string += "</ul>";

  let modal_body = document.getElementById("confirmation_dialog");
  if (!modal_body) {
    console.error("Could not find the modal body");
    return;
  }

  if (options.download_new_course === false && options.spreadsheet === true) {
    option_string = "Only creating spreadsheet. No changes to course.";
  }
  if (options.test) {
    option_string = "Testing the tarball. No changes will be made.";
  }

  modal_body.innerHTML = `
        <p><b>Preparing to process</b> ${input_file.name}</p>
        <p>It is ${megabytes}.</p>
        <p>Options currently set:</p>
        ${option_string}
    `;
}

/**
 * Takes in the file and sends it off to other functions for processing
 *
 * @returns
 */
async function processFile(): Promise<void> {
  let gzip_blob = new Blob();
  let course_sheet = "";
  let course_name = "processed_course";

  console.debug("Processing file");
  // Show the "working" button
  let working_button = document.getElementById("working_button");
  if (!working_button) {
    console.error("Cannot find the working button");
    return;
  }
  working_button.style.display = "inline-block";

  await updateStatus("Getting options");
  let options = getOptions();
  await updateStatus("Loading file");
  let tar_content = await getTarFiles();
  if (!tar_content) {
    console.error("Could not get tar files");
    return;
  }
  if (options.test) {
    testFile();
    return;
  }

  // Get the individual json files from the tarball
  // (We're not altering any other files.)
  await updateStatus("Parsing JSON");
  let json_files = [];
  for await (const f of tar_content.entries) {
    if (f.fileName.includes("/._")) {
      continue;
    }
    if (f.fileName.includes(".json") && f.typeFlag === "0") {
      const filename = f.fileName;
      json_files.push({
        name: filename,
        data_string: f.getContentAsText(),
        data: [],
      });
    }
  }

  // The data attribute will be an explicit "any" later on, because there are
  // multiple types of JSON files that we'll be working with.

  // Parse all the JSON in the files
  json_files.forEach((f) => {
    try {
      f.data = JSON.parse(f.data_string);
    } catch (e) {
      console.error("Could not parse JSON for file", f.name);
      console.error(e);
    }
  });

  let repo_file = json_files.filter((e) => e.name === "repository.json");
  if (repo_file.length === 0) {
    console.error("Could not find repository.json");
    return;
  }
  let repo_data = repo_file[0].data;
  course_name = getCourseName(repo_data);

  console.debug(course_name);
  console.debug(json_files);
  console.debug(options);

  // Only process if we're going to output a new course.
  if (options.download_new_course) {
    // Handles lock, unlock, required, and optional
    if (
      options.lock_unlock !== "no_change" ||
      options.required_optional !== "no_change" ||
      options.section_scope !== "no_change"
    ) {
      json_files = await processSections(json_files, options);
      console.debug("Sections processed");
      console.debug(json_files);
    }

    // If we're locking and requiring the course, let's make every video "cannot skip ahead".
    // If we're unlocking, free the videos from the shackles of linear time.
    if (
      options.lock_unlock === "lock" &&
      options.required_optional === "require"
    ) {
      json_files = disableVideoScrubbing(json_files);
      console.debug("Video scrubbing disabled");
    } else if (options.lock_unlock === "unlock") {
      json_files = disableVideoScrubbing(json_files, false);
      console.debug("Video scrubbing enabled");
    }

    // The LXP currently exports things that it itself cannot import.
    // This is surely wise and will never come back to bite them in the-- oh too late.
    // This function zaps the things that break imports.
    if (options.clean) {
      json_files = await cleanCourse(json_files);
      console.debug("Course cleaned");
    }

    // Write json files back to our existing tar.
    gzip_blob = await writeTarFile(tar_content, json_files);
  }

  // Create the course spreadsheet as a csv.
  if (options.spreadsheet) {
    course_sheet = createCourseSheet(json_files);
  }

  // Make the donwload links
  if (options.download_new_course || options.spreadsheet) {
    makeDownloadLinks(gzip_blob, working_button, course_sheet, course_name);
  }
}

/**
 * This takes in the file, unzips it, untars it,
 * and then literally just tars and zips it back up again.
 *
 * @returns
 */
async function testFile(): Promise<void> {
  let new_tarball = new Archive();

  console.debug("Processing file");
  // Show the "working" spinner
  let working_button = document.getElementById("working_button");
  if (!working_button) {
    console.error("Cannot find the working button");
    return;
  }
  working_button.style.display = "inline-block";

  let tar_content = await getTarFiles();
  if (!tar_content) {
    console.error("Could not get tar files");
    return;
  }

  for (const f of tar_content.entries) {
    console.debug(f.fileNamePrefix);
    console.debug(f.fileName);
    if (f.fileSize === 0) {
      new_tarball.addDirectory(f.fileName);
    } else {
      if (f.fileNamePrefix === "" || f.fileName.startsWith(f.fileNamePrefix)) {
        new_tarball.addBinaryFile(f.fileName, f.toUint8Array());
      } else {
        new_tarball.addBinaryFile(
          f.fileNamePrefix + "/" + f.fileName,
          f.content as Uint8Array
        );
      }
    }
  }

  // for (const g of new_tarball.entries) {
  //   console.debug(g.fileName);
  // }

  // Re-gzip the file
  let tarball_uint8 = new_tarball.toUint8Array();
  let gzip_blob = new Blob([gzip(tarball_uint8)], {
    type: "application/gzip",
  });

  makeDownloadLinks(gzip_blob, working_button, "", "test_course");
}

/**
 * Takes in the tgz file, unzips it, untars it, and returns the reader.
 *
 * @returns a TarReader object
 */
async function getTarFiles(): Promise<Archive> {
  // Get the file
  const input_file_element = document.getElementById(
    "input_tarball"
  ) as HTMLInputElement;
  if (!input_file_element.files) {
    console.error("Could not find the file");
    return new Promise(() => { });
  }
  if (input_file_element.files.length === 0) {
    console.error("No file uploaded");
    return new Promise(() => { });
  }
  const input_file = input_file_element.files[0];

  // Ungzip the file.
  await updateStatus("Expanding file");
  const input_buffer = new Uint8Array(await input_file.arrayBuffer());
  const file_data = ungzip(input_buffer, {});
  // Untar the file.
  await updateStatus("Extracting data");
  const tar_entries = await Archive.extract(file_data);
  return tar_entries;
}

/**
 * Handles all locking/unlocking and required/optional settings.
 * Passes sectioning off to another function.
 *
 * @param json_files
 * @param options taken from the form
 * @returns the revised JSON files
 */
async function processSections(
  json_files: { name: string; data_string: string; data: any[] }[],
  options: {
    lock_unlock: string;
    required_optional: string;
    section_scope: string;
    clean: boolean;
    spreadsheet: boolean;
  }
): Promise<{ name: string; data_string: string; data: any[] }[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0];
  await updateStatus("Processing sections");

  // In every "SECTION" activity, apply or remove both lock and "completion required".
  // We're smashing whatever is there now.
  for (let activity of activities.data) {
    if (activity.type === "SECTION") {
      if (options.lock_unlock === "lock") {
        activity.data.locked = true;
      } else if (options.lock_unlock === "unlock") {
        activity.data.locked = false;
      }
      if (options.required_optional === "require") {
        activity.data.completionRequired = true;
      } else if (options.required_optional === "optional") {
        activity.data.completionRequired = false;
      }
    }
  }
  activities.data_string = JSON.stringify(activities.data, null, 2);

  if (options.section_scope !== "no_change") {
    json_files = await sectionCourse(json_files, options.section_scope);
  }

  // Send back the updated json files
  return json_files;
}

/**
 * Splits a course up into sections, either putting each TE in its own section
 * or putting all TEs on a single page into a single section.
 *
 * @param json_files
 * @param section_scope
 * @returns
 */
async function sectionCourse(
  json_files: { name: string; data_string: string; data: any[] }[],
  section_scope: string
): Promise<{ name: string; data_string: string; data: any[] }[]> {
  //  Notes:
  //   - Every TE already has its own individual Invisible, so we can work with those
  //     instead of having to work with actual TEs.
  //   - Don't double-wrap singleton TEs in multiple Invisibles by accident.
  //   - Relevant Structure: Page --> Section Container --> Section(s) --> Invisible(s)
  //   - Skip detached activities.

  console.debug("Section scope: " + section_scope);

  let activities = json_files.filter((e) => e.name.includes("activities"))[0]
    .data;
  let elements = json_files.filter((e) => e.name.includes("elements"))[0].data;

  let repo_id = activities[0]["repository_id"];
  let current_id = 1000000000000000; // Just picking something arbitrarily high to avoid collisions with existing materials.

  let pages = activities.filter(function (a) {
    return a.type === "LONG_HLXP_SCHEMA/PAGE" && !a.detached && !a.deleted_at;
  });

  pages.forEach(function (p) {
    // Get all the section containers for this page and sort them by position.
    let section_containers = activities.filter((a) => a.parent_id == p.id);
    section_containers = section_containers.sort(function (a, b) {
      return a.position - b.position;
    });
    let section_container_ids = section_containers.map((sc) => sc.id);

    // Get all the sections for this page.
    let sections = activities.filter(function (a) {
      return (
        section_container_ids.includes(a.parent_id) &&
        !a.detached &&
        !a.deleted_at
      );
    });
    // Temporarily attach the position of the section container to each section.
    sections.forEach(function (s) {
      s.sc_position = section_containers.find(
        (sc) => sc.id == s.parent_id
      ).position;
    });
    // No need to sort these; they're all getting thrown out anyway.
    let section_ids = sections.map((s) => s.id);

    // Get all the invisibles for this page and sort them by position.
    let invisibles = activities.filter(function (a) {
      return section_ids.includes(a.parent_id) && !a.detached && !a.deleted_at;
    });
    // Add the position of the section container and the section to each invisible.
    invisibles.forEach(function (i) {
      i.sc_position = sections.find((s) => s.id == i.parent_id).sc_position;
      i.section_position = sections.find((s) => s.id == i.parent_id).position;
    });
    // Sort by own position and then by parent's position and then grandparents'.
    invisibles = invisibles.sort(function (a, b) {
      return (
        a.position - b.position ||
        a.section_position - b.section_position ||
        a.sc_position - b.sc_position
      );
    });

    // Update the positions of the invisibles. This should put them in order down the page.
    invisibles.forEach(function (inv, index) {
      inv.position = index + 1;
    });

    // Create one and only one new section container for each page
    activities.push({
      id: current_id,
      repository_id: repo_id,
      parent_id: p.id,
      uid: makeUUID(),
      type: "SECTION_CONTAINER",
      position: 1,
      data: {},
      refs: {},
      detached: false,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      modified_at: null,
    });

    let sc_id = current_id;
    current_id += 1;

    if (section_scope === "section_per_te") {
      // Each invisible is getting its own section.
      console.debug("Sectioning by TE");
      invisibles.forEach(function (i) {
        activities.push({
          id: current_id,
          repository_id: repo_id,
          parent_id: sc_id,
          uid: makeUUID(),
          type: "SECTION",
          position: i.position,
          data: { title: "" },
          refs: {},
          detached: false,
          published_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          modified_at: null,
        });

        // Move the invisible into the new section.
        // Position value should already be in the right order (and doesn't need to start at 1.)
        i.parent_id = current_id;
        i.updated_at = new Date().toISOString();
        i.modified_at = new Date().toISOString();
        i.deleted_at = null;

        current_id += 1;
      });
    } else if (section_scope === "section_per_page") {
      // Create one section for each section container on the page.
      console.debug("Sectioning by page");
      let one_section = {
        id: current_id,
        repository_id: repo_id,
        parent_id: sc_id,
        uid: makeUUID(),
        type: "SECTION",
        position: 1,
        data: { title: p.data.title },
        refs: {},
        detached: false,
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        modified_at: null,
      };
      // All invisibles on this page go into that section container.
      invisibles.forEach(function (i) {
        i.parent_id = one_section.id;
      });
      activities.push(one_section);
      current_id += 1;
    }

    // Now that we're done with all invisibles in this page,
    // detach the previous set of section containers and sections.
    section_containers.forEach(function (sc) {
      sc.detached = true;
      sc.deleted_at = new Date().toISOString();
      sc.modified_at = new Date().toISOString();
      sc.updated_at = new Date().toISOString();
    });

    sections.forEach(function (s) {
      s.detached = true;
      s.deleted_at = new Date().toISOString();
      s.modified_at = new Date().toISOString();
      s.updated_at = new Date().toISOString();
    });
  });

  // Clear out temporary position values.
  for (let act of activities) {
    try {
      delete act.sc_position;
    } catch (e) { }
    try {
      delete act.section_position;
    } catch (e) { }
  }

  let all_element_parents = elements.map((e) => e.activity_id);

  // Keep only INVISIBLE_CONTAINERs that have child elements.
  let empty_invisible_ids = activities
    .filter(function (a) {
      return (
        a.type === "INVISIBLE_CONTAINER" && !all_element_parents.includes(a.id)
      );
    })
    .map((a) => a.id);
  let non_empty_activities = activities.filter(function (a) {
    return !empty_invisible_ids.includes(a.id);
  });

  // Keep only SECTIONs that have child activities.
  let sections_with_children = activities
    .filter(function (a) {
      return (
        a.type === "INVISIBLE_CONTAINER" ||
        a.type === "CEK_QUESTION_SET" ||
        a.type === "EXPAND_CONTAINER"
      );
    })
    .map((a) => a.parent_id);
  let empty_section_ids = activities
    .filter(function (a) {
      return a.type === "SECTION" && !sections_with_children.includes(a.id);
    })
    .map((a) => a.id);
  non_empty_activities = non_empty_activities.filter(function (a) {
    return !empty_section_ids.includes(a.id);
  });

  return await cleanCourse(json_files);
}

/**
 * Makes it so you can't fast-forward through videos.
 * (or if "scrub" is false, makes it so you can)
 * @param json_files
 * @param scrub
 * @returns
 */
function disableVideoScrubbing(
  json_files: {
    name: string;
    data_string: string;
    data: any[];
  }[],
  scrub = true
): { name: string; data_string: string; data: any[] }[] {
  // If we're locking and requiring the course, let's make every video "cannot skip ahead".
  let elements = json_files.filter((e) => e.name.includes("element"))[0];
  elements.data.forEach((e) => {
    if (e.type === "VIDEO") {
      e.data.disableScrubbing = scrub;
      if (scrub) {
        e.data.completionPercentage = 95; // Allows for a ~10 second bumper on a 3 minute video.
      }
    }
  });

  return json_files;
}

/**
 * Placeholder
 * @param json_files
 * @returns The course's JSON files
 */
async function cleanCourse(
  json_files: {
    name: string;
    data_string: string;
    data: any[];
  }[]
): Promise<{
  name: string;
  data_string: string;
  data: any[];
}[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0]
    .data;
  let elements = json_files.filter((e) => e.name.includes("elements"))[0].data;
  await updateStatus("Cleaning course");

  // Clear out temporary position values.
  for (let act of activities) {
    try {
      delete act.sc_position;
    } catch (e) { }
    try {
      delete act.section_position;
    } catch (e) { }
  }

  // If there are any elements that are output_only and detached, we need to strip them out.
  // This is because the LXP doesn't like them. Hopefully will be fixed soon.
  let elem_no_output_detached = elements.filter(function (e) {
    return !(e.data.inputOutputType === "OUTPUT_ONLY" && e.detached);
  });
  // If there are TEs linked to a TE that doesn't exist, that causes issues too.
  // Unfortunately, we can't fix the links and they break on import.
  // Toss anything with refs.linked present (it's an array).
  // TODO: Replace with placeholders instead of just removing them.
  let elem_no_missing_links = elem_no_output_detached.filter((e) => {
    try {
      if (e.refs.linked.length > 0) {
        return false;
      }
    } catch (e) {
      return true;
    }
    return true;
  });

  let all_element_parents = elem_no_missing_links.map((e) => e.activity_id);

  // Keep only INVISIBLE_CONTAINERs that have child elements.
  let empty_invisible_ids = activities
    .filter(function (a) {
      return (
        a.type === "INVISIBLE_CONTAINER" && !all_element_parents.includes(a.id)
      );
    })
    .map((a) => a.id);
  let non_empty_activities = activities.filter(function (a) {
    return !empty_invisible_ids.includes(a.id);
  });

  // Keep only SECTIONs that have child activities.
  let sections_with_children = activities
    .filter(function (a) {
      return (
        a.type === "INVISIBLE_CONTAINER" ||
        a.type === "CEK_QUESTION_SET" ||
        a.type === "EXPAND_CONTAINER"
      );
    })
    .map((a) => a.parent_id);
  let empty_section_ids = activities
    .filter(function (a) {
      return a.type === "SECTION" && !sections_with_children.includes(a.id);
    })
    .map((a) => a.id);
  non_empty_activities = non_empty_activities.filter(function (a) {
    return !empty_section_ids.includes(a.id);
  });

  // Replace json strings with stringified data
  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data_string = JSON.stringify(non_empty_activities, null, 2);
    }
    if (f.name.includes("elements")) {
      f.data_string = JSON.stringify(elem_no_missing_links, null, 2);
    }
  });

  return json_files;
}

/**
 * Wraps the processed data in a tarball and gzips it
 * so we can make a download link.
 *
 * @param tar_content
 * @param json_files
 * @param course_sheet
 * @returns The gzipped tarball
 */
async function writeTarFile(
  tar_content: Archive,
  json_files: { name: string; data_string: string; data: any[] }[]
): Promise<Blob> {
  let new_tarball = new Archive();
  await updateStatus("Assembling files");

  const course_structure_files = [
    "activities.json",
    "elements.json",
    "manifest.json",
    "repository.json",
  ];

  for await (const f of tar_content.entries) {
    // console.debug(f.fileName);
    // Skip the . and .. directories
    if (f.fileName === "." || f.fileName === "..") {
      continue;
    }
    if (course_structure_files.includes(f.fileName)) {
      const file_string = json_files.filter((e) => e.name === f.fileName)[0]
        .data_string;
      new_tarball.addTextFile(f.fileName, file_string);
    } else {
      if (f.fileSize === 0) {
        // We're treating all size 0 "files" as folders, which I know is not necessarily correct.
        // I would like to use f.type here, but there are complications.
        // type 53 is a folder, type 48 is a file.
        // There's a Type 120, no idea what that is but it shows up sometimes with PaxHeaders.
        // There's also a pending pull request to switch 53 and 48 to 0 and 5.
        // Would be nice if we could just use names.
        new_tarball.addDirectory(f.fileName);
      } else {
        if (
          f.fileNamePrefix === "" ||
          f.fileName.startsWith(f.fileNamePrefix)
        ) {
          new_tarball.addBinaryFile(f.fileName, f.toUint8Array());
        } else {
          new_tarball.addBinaryFile(
            f.fileNamePrefix + "/" + f.fileName,
            f.content as Uint8Array
          );
        }
      }
    }
  }

  // Print out all the filenames.
  // for await (const f of new_tarball.entries) {
  //   console.debug(f.fileName);
  // }

  // Re-zip the file
  await updateStatus("Writing file");
  let tarball_uint8 = new_tarball.toUint8Array();
  let gzip_blob = new Blob([gzip(tarball_uint8)], {
    type: "application/gzip",
  });
  return gzip_blob;
}

/**
 * Creates a download link for the importable gzip file.
 * @param gzip_blob
 * @param working_button
 * @returns
 */
async function makeDownloadLinks(
  gzip_blob: Blob,
  working_button: HTMLElement,
  course_sheet: string,
  course_name: string
): Promise<void> {
  // Hide the "working" spinner
  working_button.style.display = "none";

  // Show the download button
  let download_button = document.getElementById("download_button");
  if (!download_button) {
    console.debug("Cannot find the download button");
    return;
  }
  if (gzip_blob.size > 0) {
    console.log("Making course download button work");
    // Provide the file in a Data URI
    let data_uri = URL.createObjectURL(gzip_blob);
    download_button.setAttribute("href", data_uri);
    download_button.setAttribute("download", course_name + ".tgz");
  }
  download_button.classList.add("btn-success");
  download_button.classList.remove("btn-secondary");
  download_button.style.pointerEvents = "auto";
  download_button.style.display = "inline-block";
  document.querySelector("body")?.scrollIntoView();

  // If we have a course sheet, make a download link for that too,
  // but do a hidden one that's triggered when we click the regular download link.
  if (course_sheet !== "") {
    let sheet_blob = new Blob([course_sheet], { type: "text/csv" });
    let sheet_uri = URL.createObjectURL(sheet_blob);
    let sheet_link = document.createElement("a");
    sheet_link.setAttribute("href", sheet_uri);
    sheet_link.id = "spreadsheet_download_link";
    sheet_link.setAttribute("download", "course_sheet_" + course_name + ".csv");
    sheet_link.style.display = "none";
    document.body.appendChild(sheet_link);
    download_button.addEventListener("click", () => {
      sheet_link.click();
    });
  }
  await updateStatus("Download");
}

// Separate function just in case I need to change it later.
function makeUUID(): string {
  return uuidv4();
}

// Basic sleep function 
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms || 1000));
}
