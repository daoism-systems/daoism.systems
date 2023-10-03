import * as React from "react";
import styles from "../index.module.scss";

const iconTwo = (
  <svg
    width="44"
    height="39"
    viewBox="0 0 44 39"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9.04799 9.19196C9.04799 11.5589 7.12921 13.4777 4.76228 13.4777C2.39534 13.4777 0.476562 11.5589 0.476562 9.19196C0.476562 6.82503 2.39534 4.90625 4.76228 4.90625C7.12921 4.90625 9.04799 6.82503 9.04799 9.19196Z"
      fill="white"
    />
    <path
      d="M9.04799 29.9065C9.04799 32.2734 7.12921 34.1922 4.76228 34.1922C2.39534 34.1922 0.476562 32.2734 0.476562 29.9065C0.476562 27.5395 2.39534 25.6208 4.76228 25.6208C7.12921 25.6208 9.04799 27.5395 9.04799 29.9065Z"
      fill="white"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M23.6479 0.621094H14.0479V38.4782H25.1622C35.198 38.4782 43.3336 30.3426 43.3336 20.3068C43.3336 9.43469 34.52 0.621094 23.6479 0.621094ZM24.4051 5.62109H19.7622V33.4782H24.4051C32.0976 33.4782 38.3336 27.2422 38.3336 19.5497C38.3336 11.8571 32.0976 5.62109 24.4051 5.62109Z"
      fill="white"
    />
  </svg>
);

const iconThree = (
<svg 
  width="82" 
  height="79" 
  viewBox="0 0 79 82" 
  fill="none" 
  xmlns="http://www.w3.org/2000/svg"
  >
  
  <path fill-rule="evenodd" clip-rule="evenodd" d="M2.979 32.74 16.334 9.778 27.848 3.04l26.672-.063 11.738 6.782 13.279 23.02v13.4l-13.619 22.96-11.274 6.675-26.723-.09-11.575-6.502-13.264-22.84-.103-13.642Z" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M54.514.727c.397-.001.787.103 1.131.301l11.74 6.782c.341.198.625.482.822.824l13.279 23.02c.197.342.3.73.3 1.125v13.4c0 .404-.108.8-.314 1.147L67.854 70.287a2.25 2.25 0 0 1-.79.789L55.792 77.75a2.25 2.25 0 0 1-1.154.314l-26.724-.09a2.25 2.25 0 0 1-1.094-.289l-11.575-6.502a2.25 2.25 0 0 1-.844-.832L1.136 47.511a2.25 2.25 0 0 1-.304-1.113L.729 32.758a2.25 2.25 0 0 1 .305-1.149L14.39 8.646a2.25 2.25 0 0 1 .808-.81l11.513-6.738A2.25 2.25 0 0 1 27.842.79L54.514.727ZM28.46 5.288l-10.478 6.133L5.233 33.338l.094 12.429L17.983 67.56l10.53 5.914 25.519.087 10.245-6.065 13.01-21.935V33.38L64.61 11.405 53.919 5.228l-25.459.06Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m3.082 46.383 6.85-12.03L9.61 21.34l13.267.102.093 13.31-13.038-.4L16.36 46.38 9.67 57.728l11.392 6.002 6.859 11.996" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M8.006 19.762a2.25 2.25 0 0 1 1.621-.672l13.268.102a2.25 2.25 0 0 1 2.232 2.234l.093 13.31a2.25 2.25 0 0 1-2.319 2.265l-9.152-.28 4.596 8.598a2.25 2.25 0 0 1-.046 2.203l-5.492 9.315 9.304 4.902c.378.2.692.503.904.874l6.86 11.996-3.907 2.234-6.534-11.428-10.813-5.697a2.25 2.25 0 0 1-.89-3.133l6.05-10.26L9.87 39.01l-4.833 8.487-3.91-2.227 6.54-11.486-.306-12.388a2.25 2.25 0 0 1 .645-1.633Zm4.123 12.407-.212-8.561 8.726.067.06 8.756-8.574-.262Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m21.062 63.73 7.022-10.663L16.36 46.38l13.392-.238-6.782-11.388" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m24.903 33.603 6.782 11.389a2.25 2.25 0 0 1-1.893 3.4l-5.202.093 4.608 2.628a2.25 2.25 0 0 1 .765 3.192L22.94 64.968l-3.759-2.475 5.703-8.66-9.64-5.498a2.25 2.25 0 0 1 1.075-4.204l9.514-.169-4.798-8.056 3.867-2.303Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m29.752 46.142-.211-13.564-6.664-11.135 7.48-11.857-14.022.193" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M32.32 8.486a2.25 2.25 0 0 1-.06 2.3l-6.743 10.688 5.954 9.948c.203.34.313.726.32 1.12L32 46.108l-4.499.07-.202-12.961-6.354-10.618a2.25 2.25 0 0 1 .028-2.356l5.267-8.35-9.875.137-.062-4.5 14.022-.193a2.25 2.25 0 0 1 1.993 1.15Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M30.357 9.586 41.24 3.008l6.516 11.395 13.776.81L54.52 2.977" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M41.805.83a2.25 2.25 0 0 1 1.389 1.06l5.91 10.338 8.408.495-4.944-8.627 3.904-2.238 7.012 12.236A2.25 2.25 0 0 1 61.4 17.46l-13.776-.81a2.25 2.25 0 0 1-1.821-1.13l-5.372-9.393-8.91 5.385-2.328-3.85 10.883-6.579a2.25 2.25 0 0 1 1.73-.252Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m61.53 15.213 11.228 5.813-6.756 11.49-11.49-6.57 7.019-10.733Z" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M59.648 13.982a2.25 2.25 0 0 1 2.917-.767l11.227 5.813a2.25 2.25 0 0 1 .905 3.139l-6.756 11.49a2.25 2.25 0 0 1-3.056.813l-11.49-6.57a2.25 2.25 0 0 1-.766-3.184l7.019-10.734Zm2.653 4.164-4.598 7.034 7.486 4.28 4.426-7.527-7.314-3.787Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m54.513 25.947-13.245.114 6.487-11.658-11.43 6.784-5.968-11.601" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m37.233 18.032-4.875-9.475-4.002 2.058 5.968 11.601a2.25 2.25 0 0 0 3.15.906l4.263-2.53-2.435 4.375a2.25 2.25 0 0 0 1.986 3.344l13.245-.114-.04-4.5-9.38.08 4.608-8.28a2.25 2.25 0 0 0-3.114-3.029l-9.374 5.564Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m36.325 21.188-6.785 11.39 11.728-6.517 11.622 6.776 13.111-.32 6.24 12.39 7.296-12.127" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m27.607 31.425 6.785-11.39 3.866 2.303-2.512 4.216 4.43-2.46a2.25 2.25 0 0 1 2.225.023l11.072 6.454 12.473-.304a2.25 2.25 0 0 1 2.065 1.238l4.405 8.746 5.193-8.632 3.856 2.32-7.296 12.127a2.25 2.25 0 0 1-3.938-.147L64.632 34.8l-11.687.284a2.25 2.25 0 0 1-1.188-.306L41.24 28.65l-10.608 5.895a2.25 2.25 0 0 1-3.026-3.119Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m72.24 44.907.484 12.76-13.432-.033.132-13.347 12.816.62Z" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M57.88 42.65a2.25 2.25 0 0 1 1.653-.61l12.816.62a2.25 2.25 0 0 1 2.14 2.162l.483 12.76a2.25 2.25 0 0 1-2.253 2.335l-13.432-.033a2.25 2.25 0 0 1-2.245-2.272l.132-13.347a2.25 2.25 0 0 1 .706-1.614Zm3.77 3.998-.086 8.742 8.823.021-.317-8.356-8.42-.407Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m59.424 44.288-6.534-11.45-.318 13.33 6.72 11.467-7.386 11.458 14.013.049" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M52.34 30.655a2.25 2.25 0 0 1 2.504 1.066l6.535 11.45-3.909 2.23-2.523-4.422-.11 4.602 6.396 10.914a2.25 2.25 0 0 1-.05 2.357l-5.159 8.004 9.903.034-.016 4.5-14.013-.049a2.25 2.25 0 0 1-1.883-3.469l6.636-10.295-6.02-10.272a2.249 2.249 0 0 1-.308-1.191l.318-13.331a2.25 2.25 0 0 1 1.698-2.128Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M51.906 69.092 41.263 75.77l-6.46-11.48 10.74-6.608 6.363 11.41Z" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M46.112 55.505a2.25 2.25 0 0 1 1.397 1.08l6.362 11.41a2.25 2.25 0 0 1-.77 3.002L42.46 77.675a2.25 2.25 0 0 1-3.157-.802l-6.459-11.48a2.25 2.25 0 0 1 .782-3.02l10.74-6.608a2.25 2.25 0 0 1 1.747-.26Zm-8.286 9.567 4.24 7.537 6.834-4.288-4.177-7.492-6.897 4.243Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m45.542 57.682 7.03-11.514-11.373 6.557-6.395 11.565-13.743-.56" fill="#000" fill-opacity=".01"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M54.183 44.597a2.25 2.25 0 0 1 .31 2.743l-7.03 11.514-3.84-2.344 2.435-3.989-3.193 1.84-6.09 11.018a2.25 2.25 0 0 1-2.061 1.16l-13.743-.56.183-4.497 12.354.503 5.722-10.349a2.25 2.25 0 0 1 .846-.86l11.373-6.557a2.25 2.25 0 0 1 2.734.378Z" fill="#fff"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="m28.084 53.068 13.115-.342-11.447-6.583" fill="#000" fill-opacity=".01"/><path fill-rule="evenodd" clip-rule="evenodd" d="m30.874 44.191 11.447 6.583a2.25 2.25 0 0 1-1.063 4.2l-13.115.342-.118-4.498 5.113-.134-4.508-2.592 2.244-3.9Z" fill="#fff"/>
  </svg>
);

const iconFour = (
  <svg
    width="69"
    height="51"
    viewBox="0 0 69 51"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M58.0677 23.3724C59.1027 22.5144 59.1435 22.0115 59.1435 21.9285C59.1435 21.8455 59.1027 21.3426 58.0677 20.4846C57.0513 19.642 55.4004 18.7489 53.0962 17.941C49.8624 16.807 45.6602 15.9508 40.8833 15.5453C38.9066 15.7483 36.812 15.8574 34.6435 15.8574C32.475 15.8574 30.3804 15.7483 28.4037 15.5453C23.6267 15.9508 19.4245 16.807 16.1907 17.941C13.8866 18.7489 12.2356 19.642 11.2192 20.4846C10.1843 21.3426 10.1435 21.8455 10.1435 21.9285C10.1435 22.0115 10.1843 22.5144 11.2192 23.3724C12.2356 24.215 13.8866 25.1081 16.1907 25.916C17.8821 26.5091 19.8384 27.0262 22.0032 27.4426C25.9097 26.881 30.1757 26.5719 34.6434 26.5719C39.1111 26.5719 43.3771 26.881 47.2837 27.4426C49.4486 27.0262 51.4048 26.5091 53.0962 25.916C55.4004 25.1081 57.0513 24.215 58.0677 23.3724Z"
      fill="white"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M34.6435 12.8574C32.463 12.8574 30.3785 12.7419 28.4373 12.5322C25.2372 12.1866 22.4261 11.5852 20.2152 10.8241C18.4247 10.2077 17.1905 9.54167 16.4636 8.95004C16.113 8.66466 15.9577 8.46505 15.8918 8.35742C15.9577 8.2498 16.113 8.05018 16.4636 7.7648C17.1905 7.17318 18.4247 6.50716 20.2152 5.89073C23.7674 4.66787 28.8685 3.85742 34.6435 3.85742C40.4185 3.85742 45.5196 4.66787 49.0718 5.89073C50.8623 6.50716 52.0965 7.17318 52.8234 7.7648C53.174 8.05018 53.3293 8.2498 53.3952 8.35743C53.3293 8.46505 53.174 8.66466 52.8234 8.95004C52.0965 9.54167 50.8623 10.2077 49.0718 10.8241C46.8609 11.5852 44.0498 12.1866 40.8497 12.5322C38.9085 12.7419 36.824 12.8574 34.6435 12.8574ZM53.44 8.26692L53.4404 8.26419C53.4404 8.26419 53.4382 8.26879 53.4362 8.27813L53.4386 8.27133L53.44 8.26692ZM15.8466 8.26419C15.8466 8.26419 15.8488 8.26879 15.8508 8.27813C15.8473 8.26888 15.8466 8.26419 15.8466 8.26419ZM15.8466 8.45065C15.8466 8.45065 15.8473 8.44596 15.8508 8.43671C15.8488 8.44605 15.8466 8.45065 15.8466 8.45065ZM53.4362 8.43671C53.4397 8.44596 53.4404 8.45065 53.4404 8.45065C53.4404 8.45065 53.4382 8.44605 53.4362 8.43671ZM47.3434 30.4837C43.5444 31.1785 39.2248 31.5714 34.6435 31.5714C30.0622 31.5714 25.7425 31.1785 21.9435 30.4837C18.032 31.0726 14.5464 31.9212 11.6632 32.9531C8.7812 33.9845 6.66125 35.1426 5.31895 36.2784C3.96325 37.4255 3.71484 38.2611 3.71484 38.7148C3.71484 39.1685 3.96325 40.0041 5.31895 41.1512C6.66125 42.287 8.7812 43.4451 11.6632 44.4765C17.4012 46.5301 25.5257 47.8577 34.6434 47.8577C43.7612 47.8577 51.8856 46.5301 57.6236 44.4765C60.5056 43.4451 62.6256 42.287 63.9679 41.1512C65.3236 40.0041 65.572 39.1685 65.572 38.7148C65.572 38.2611 65.3236 37.4255 63.9679 36.2784C62.6256 35.1426 60.5056 33.9845 57.6236 32.9531C54.7405 31.9212 51.2549 31.0726 47.3434 30.4837ZM34.6435 28.5714C30.0085 28.5714 25.7015 28.154 22.0032 27.4426C25.9097 26.881 30.1757 26.5719 34.6434 26.5719C39.1111 26.5719 43.3771 26.881 47.2837 27.4426C43.5854 28.154 39.2784 28.5714 34.6435 28.5714Z"
      fill="white"
    />
  </svg>
);

const Customers = ({}) => (
  <div className={`${styles.referencesList} referencesTop`}>
    <a href="https://doingud.com/" target="_blank" className={styles.topItem}>
      <div className={styles.icon}>{iconTwo}</div>
      <div className={styles.text}>DoinGud</div>
    </a>

    <a href="https://powerpool.finance/" target="_blank" className={styles.topItem}>
      <div className={styles.icon}>{iconThree}</div>
      <div className={styles.text}>Powerpool</div>
    </a>

    <a href="https://balancer.fi/" target="_blank" className={styles.topItem}>
      <div className={styles.icon}>{iconFour}</div>
      <div className={styles.text}>Balancer</div>
    </a>
  </div>
);

export default Customers;
