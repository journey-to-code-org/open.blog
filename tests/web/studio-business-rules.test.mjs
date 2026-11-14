// Ported from tests/web/admin-business.test.mjs for the old Admin's retirement: the same checks,
// against Studio's copy of the rules. Tests of the old screens stay with the old Admin until R15.
// The Business facts screen (ADR 0307, #508): the pure contract (phone, hours, validation, the stored
// shape) and the screen against a fake server, so every rule here is the rule the server applies.
import assert from "node:assert/strict";
import test from "node:test";

import {
  WEEKDAYS,
  businessErrorText,
  businessFromForm,
  copyDay,
  formFromBusiness,
  formatPhone,
  normalizePhone,
  sameBusiness,
  validateForm,
} from "../../web/studio/parts/business-rules.js";
import { ApiError, choose, tick, type, withDom } from "./dom-shim.mjs";

const named = (root, name) => root.querySelectorAll("input, select").find((node) => node.attributes.name === name);
const problemFor = (root, key) => root.querySelectorAll("p").find((p) => p.dataset.problemFor === key);
const text = (node) => node.textContent.replace(/\s+/g, " ").trim();

const STORED = {
  version: 1,
  displayName: "Maple Falls Flooring",
  trade: "flooring",
  phone: "+13605550142",
  hours: { monday: { open: "08:00", close: "17:00" }, sunday: { closed: true } },
  insured: true,
  paymentMethods: ["cash"],
  foundedYear: 1998,
  "x-future": { keep: 1 },
};

function server(initial = {}) {
  const state = { business: structuredClone(STORED), etag: "e1", ...initial };
  return {
    state,
    calls: [],
    next: null,
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (this.next) {
        const failure = this.next;
        this.next = null;
        throw failure;
      }
      const described = () => ({
        business: structuredClone(state.business),
        etag: state.etag,
        problems: [],
        trades: ["flooring", "plumbing", "other"],
        weekdays: WEEKDAYS.map(([id, label]) => ({ id, label })),
      });
      if (method === "GET") return described();
      state.business = { version: 1, ...options.json.business };
      if (state.business.phone) state.business.phone = normalizePhone(state.business.phone);
      state.etag = `e${this.calls.length}`;
      return { ...described(), buildError: null };
    },
  };
}

test("a typed phone becomes E.164 and is shown the way a person reads it", () => {
  assert.equal(normalizePhone("(360) 555-0142"), "+13605550142");
  assert.equal(normalizePhone("1-360-555-0142"), "+13605550142");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("  "), "");
  assert.equal(normalizePhone("call me"), "call me");
  assert.equal(formatPhone("+13605550142"), "(360) 555-0142");
  assert.equal(formatPhone("+442079460958"), "+442079460958");
});

test("a stored block round-trips through the form without losing or inventing anything", () => {
  const form = formFromBusiness(STORED);
  assert.equal(form.hours.monday.mode, "open");
  assert.equal(form.hours.sunday.mode, "closed");
  assert.equal(form.hours.tuesday.mode, "unset");
  const back = businessFromForm(form);
  const { version, "x-future": future, ...known } = STORED;
  void version;
  void future;
  assert.deepEqual(back, known);
  assert.deepEqual(businessFromForm(formFromBusiness({})), {});
  assert.deepEqual(businessFromForm(formFromBusiness(null)), {});
});

test("open all day is the stored 00:00 to 24:00 and comes back as itself", () => {
  const form = formFromBusiness({ hours: { saturday: { open: "00:00", close: "24:00" } } });
  assert.equal(form.hours.saturday.mode, "allday");
  assert.deepEqual(businessFromForm(form).hours, { saturday: { open: "00:00", close: "24:00" } });
});

test("problems are plain, named by field and day, and match the server's rules", () => {
  const form = formFromBusiness({});
  Object.assign(form, { phone: "call us", email: "nope", foundedYear: "1066", licenseIssuer: "State", licenseNumber: "" });
  form.hours.monday = { mode: "open", open: "18:00", close: "09:00" };
  form.hours.tuesday = { mode: "open", open: "", close: "17:00" };
  const problems = validateForm(form);
  const fields = problems.map((p) => p.field);
  assert.deepEqual([...new Set(fields)].sort(), ["email", "foundedYear", "hours", "licenseIssuer", "phone"]);
  assert.equal(problems.find((p) => p.day === "monday").message, "Monday: closing time must be after the opening time. For a day that runs all night, choose Open 24 hours.");
  assert.match(problems.find((p) => p.day === "tuesday").message, /choose both an opening and a closing time/);
  for (const problem of problems) assert.ok(!/[<>]|undefined|null/.test(problem.message), problem.message);
  assert.deepEqual(validateForm(formFromBusiness(STORED)), []);
  assert.deepEqual(validateForm({ ...formFromBusiness({}), phone: "(360) 555-0142" }), []);
});

test("copying a day sets the others without touching the rest", () => {
  const form = formFromBusiness(STORED);
  const copied = copyDay(form, "monday", ["tuesday", "friday"]);
  assert.deepEqual(copied.hours.tuesday, form.hours.monday);
  assert.equal(copied.hours.sunday.mode, "closed");
  assert.equal(copied.hours.wednesday.mode, "unset");
  assert.ok(!sameBusiness(form, copied));
  assert.ok(sameBusiness(form, formFromBusiness(STORED)));
});

test("error words say what to do and never pass a server's markup through as more than text", () => {
  assert.match(businessErrorText({ status: 409 }), /Reload them/);
  assert.match(businessErrorText({ status: 413 }), /too much/);
  assert.match(businessErrorText({ status: 500, message: "Boom" }), /not saved\. Boom/);
  assert.match(businessErrorText({}), /Check your connection/);
});

// ----- the screen -------------------------------------------------------------

