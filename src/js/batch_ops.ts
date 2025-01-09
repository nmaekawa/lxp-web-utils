"use strict";

import { v4 as uuidv4 } from "uuid";
import { updateStatus } from "./index";

/**
 * Handles all locking/unlocking and required/optional settings.
 * Passes sectioning off to another function.
 *
 * @param json_files
 * @param options taken from the form
 * @returns the revised JSON files
 */
export async function processSections(
  json_files: { name: string; data: any[] }[],
  options: {
    lock_unlock: string;
    required_optional: string;
    section_scope: string;
    clean: boolean;
    spreadsheet: boolean;
    video_credits: boolean;
    video_intro: boolean;
  }
): Promise<{ name: string; data: any[] }[]> {
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

  if (options.section_scope !== "no_change") {
    json_files = await sectionCourse(
      json_files,
      options.section_scope,
      options.video_credits,
      options.video_intro
    );
  }

  // Send back the updated json files
  return json_files;
}

export async function processQuestionSets(
  json_files: { name: string; data: any[] }[],
  options: {
    pass_percent: number;
    num_attempts: number;
    show_answers: string;
    qset_display: string;
  }
): Promise<{ name: string; data: any[] }[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0];
  let question_sets = activities.data.filter((a) => a.type === "CEK_QUESTION_SET" && !a.detached && !a.deleted_at);

  // When do we show the answers?
  if (options.show_answers === "show_when_submitted") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "onSubmit";
    });
  }
  if (options.show_answers === "show_after_attempts") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "onAllowExhaust";
    });
  }
  if (options.show_answers === "show_never") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "never";
    });
  }

  // Display one question at a time or all of them?
  if (options.qset_display === "display_one") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayQuestions = "one";
    });
  }
  if (options.qset_display === "display_all") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayQuestions = "all";
    });
  }

  // Are we changing the number of attemtps and passing percentage?
  if (options.num_attempts > 0) {
    question_sets.forEach(function (qset, i) {
      qset.data.numberOfAttempts = options.num_attempts;
    });
  }
  if (options.pass_percent > 0) {
    question_sets.forEach(function (qset, i) {
      qset.data.minimumPassingPercentage = options.pass_percent;
    });
  }

  // Write the fixed question sets back to the activities variable.
  question_sets.forEach(function (qset, i) {
    let index = activities.data.findIndex((a) => a.id === qset.id);
    activities.data[index] = qset;
  });

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
export async function sectionCourse(
  json_files: { name: string; data: any[] }[],
  section_scope: string,
  video_credits: boolean,
  video_intro: boolean,
): Promise<{ name: string; data: any[] }[]> {
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

  // If we're moving HTML TEs and Expandable containers, do that here
  // so that the sections get wiped in the next step.


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
export function disableVideoScrubbing(
  json_files: {
    name: string;
    data: any[];
  }[],
  scrub = true
): { name: string; data: any[] }[] {
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
export async function cleanCourse(
  json_files: {
    name: string;
    data: any[];
  }[]
): Promise<{
  name: string;
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

  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data = non_empty_activities;
    }
    if (f.name.includes("elements")) {
      f.data = elem_no_missing_links;
    }
  });

  return json_files;
}


/////////////////////////////////////////
// Utilities
/////////////////////////////////////////

// Separate function just in case I need to change it later.
export function makeUUID(): string {
  return uuidv4();
}

