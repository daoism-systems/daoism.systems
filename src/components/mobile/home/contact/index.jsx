import React, { useState } from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Social from "../../../social";

const iconLocation = (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M15.2459 0.534275L15.2439 0.534504C13.8362 0.694323 13.0608 0.862825 12.1873 1.1874C9.84165 2.0672 7.87944 3.67602 6.54378 5.826C5.29079 7.84868 4.71029 10.478 4.99622 12.814C5.46658 16.6188 8.2082 21.967 12.8579 27.9754L12.8583 27.9759C13.4043 28.6833 14.0302 29.4614 14.5596 30.0987C15.1017 30.7512 15.5108 31.2171 15.641 31.335C15.7798 31.4596 15.9035 31.4971 16 31.4971C16.0965 31.4971 16.2201 31.4596 16.359 31.335C16.4892 31.2171 16.8983 30.7512 17.4404 30.0987C17.9697 29.4614 18.5957 28.6833 19.1417 27.9759L19.1421 27.9754C23.3199 22.5772 25.9607 17.7221 26.7869 14.0042L26.787 14.0039C26.9975 13.0594 27.0625 12.4584 27.0625 11.4691C27.0563 8.60402 25.9106 5.86199 23.8344 3.79176L23.8333 3.79063C22.1201 2.07139 20.1098 1.0395 17.733 0.650089C17.4689 0.608027 16.9436 0.566755 16.4162 0.542641C15.878 0.518032 15.4106 0.514893 15.2459 0.534275ZM22.2504 12.5762L22.25 12.5786C21.9302 14.5929 20.6127 16.3546 18.7504 17.2621C17.6577 17.7949 16.5252 18.002 15.3691 17.8721L15.3685 17.872C14.4906 17.7722 14.0159 17.6385 13.249 17.2618C11.387 16.3542 10.0697 14.5927 9.74991 12.5786L9.74954 12.5762C9.69219 12.2035 9.68417 11.7044 9.70928 11.2337C9.73427 10.7654 9.79463 10.2762 9.89376 9.92694C10.7406 6.90696 13.7252 4.90157 16.7982 5.32346C19.326 5.66253 21.4206 7.47808 22.1062 9.92699C22.2053 10.2763 22.2657 10.7654 22.2907 11.2337C22.3158 11.7044 22.3078 12.2035 22.2504 12.5762Z"
      stroke="white"
    />
  </svg>
);

const iconClose = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.99991 6.29305L12.3032 0.989746L13.0103 1.69685L7.70702 7.00015L13.0103 12.3035L12.3032 13.0106L6.99991 7.70726L1.69661 13.0106L0.989503 12.3035L6.2928 7.00015L0.989502 1.69685L1.69661 0.989746L6.99991 6.29305Z"
      fill="white"
    />
  </svg>
);

const ContactSend = ({}) => {
  // Toggle class for status message
  const [statusMessage, setStatusMessage] = useState(false);
  const handleStatusMessage = () => {
    setStatusMessage(true);
  };

  const [status, setStatus] = useState({
    submitted: false,
    submitting: false,
    info: { error: false, msg: null },
  });

  const [inputs, setInputs] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const handleResponse = (status, msg) => {
    if (status === 200) {
      setStatus({
        submitted: true,
        submitting: false,
        info: { error: false, msg: msg },
      });
      setInputs({
        name: "",
        email: "",
        phone: "",
        message: "",
      });
    } else {
      setStatus({
        info: { error: true, msg: msg },
      });
    }
  };

  const handleOnChange = (e) => {
    e.persist();
    setInputs((prev) => ({
      ...prev,
      [e.target.id]: e.target.value,
    }));
    setStatus({
      submitted: false,
      submitting: false,
      info: { error: false, msg: null },
    });
  };

  const handleOnSubmit = async (e) => {
    e.preventDefault();
    setStatus((prevStatus) => ({ ...prevStatus, submitting: true }));
    const res = await fetch("api/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inputs),
    });
    const text = await res.text();
    handleResponse(res.status, text);
  };

  return (
    <div className={styles.contact}>
      <Title content={"Talk to us"} />
      <div className={styles.description}>
        You can contact us via this contact form or through social networks.
      </div>
      <Social />

      <form className={styles.form} onSubmit={handleOnSubmit}>
        <fieldset className={styles.inputBox}>
          <input
            onChange={handleOnChange}
            placeholder={"name"}
            required
            id={"name"}
            value={inputs.name}
            type={"text"}
            name={"name"}
          />
          <legend className={styles.legend}>Name:</legend>
        </fieldset>
        <fieldset className={styles.inputBox}>
          <input
            onChange={handleOnChange}
            placeholder={"e-mail"}
            id="email"
            required
            value={inputs.email}
            type={"email"}
            name={"email"}
          />
          <legend className={styles.legend}>E-mail:</legend>
        </fieldset>
        <fieldset className={styles.inputBox}>
          <input
            onChange={handleOnChange}
            placeholder={"phone"}
            id={"phone"}
            required
            value={inputs.phone}
            type={"tel"}
            name={"tel"}
          />
          <legend className={styles.legend}>Phone:</legend>
        </fieldset>
        <fieldset className={styles.textareaBox}>
          <legend>Your Message:</legend>
          <textarea
            onChange={handleOnChange}
            id="message"
            required
            value={inputs.message}
            name={"message"}
          />
        </fieldset>

        <div className={styles.formFooter}>
          <div className={styles.location}>
            {iconLocation}{" "}
            <span>
              Our head office is
              <br />
              located in Berlin
            </span>
          </div>

          <button
            type="submit"
            className={styles.buttonSubmit}
            disabled={status.submitting}
          >
            {!status.submitting
              ? !status.submitted
                ? "Submit"
                : "Submitted"
              : "Submitting..."}
          </button>
        </div>
      </form>

      {status.info.error && (
        <div
          className={`${styles.error} ${styles.info} ${
            statusMessage ? styles.hidden : null
          }`}
        >
          Error: {status.info.msg}
          <button type="button" onClick={handleStatusMessage}>
            {iconClose}
          </button>
        </div>
      )}
      {!status.info.error && status.info.msg && (
        <div
          className={`${styles.success} ${styles.info} ${
            statusMessage ? styles.hidden : null
          }`}
        >
          {status.info.msg}
          <button type="button" onClick={handleStatusMessage}>
            {iconClose}
          </button>
        </div>
      )}
    </div>
  );
};

export default ContactSend;
