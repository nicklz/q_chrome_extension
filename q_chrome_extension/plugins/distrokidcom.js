console.log("DISTROKID LOADED")

let state = getState();

console.log('DISTROKID STATE',state)

function setFieldValues() {
    // First name fields → "Nick"
    document.querySelectorAll(
      'input[name="songwriter_real_name_first1"], input.songwriter_real_name_first'
    ).forEach(el => {
      el.value = "Nick";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  
    // Last name fields → "Kuhn"
    document.querySelectorAll(
      'input[name="songwriter_real_name_last1"], input.songwriter_real_name_last'
    ).forEach(el => {
      el.value = "Kuhn";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  
  setFieldValues();
  