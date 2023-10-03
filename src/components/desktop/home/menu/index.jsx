import React, { useEffect, useState, useRef } from "react";
import styles from "./index.module.scss";
import Social from "../../../social";

const Menu = ({ fixed, scroll }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showMenuList, setShowMenuList] = useState(false);

  const videoRef = useRef();

  const toggle = () => {
    if (showMenu) {
      setTimeout(() => {
        videoRef.current.play();
      }, 300);
      setShowMenuList(false);
      setTimeout(() => {
        setShowMenu(false);
      }, 1000);
    } else {
      setShowMenu(true);
      videoRef.current.playbackRate = 1;
      videoRef.current.currentTime = 0;
      videoRef.current.play();

      setTimeout(() => {
        videoRef.current.pause();
      }, 2000);

      setTimeout(() => {
        setShowMenuList(true);
      }, 1000);
    }
  };

  return (
    <>
      <div className={`${styles.menu} ${showMenu ? styles.active : ""}`}>
        <div className={styles.menubg}>
          <video ref={videoRef} playsInline muted preload="true">
            <source src={"/menubg.mp4"} />
            <p className={"warning"}>
              Your browser does not support HTML5 video.
            </p>
          </video>
        </div>

        <div
          className={`${styles.menuList} ${showMenuList ? styles.active : ""}`}
        >
          <ul>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0 * scroll.scrollHeight), toggle()
                )}
              >
                <span>home</span>Home<span>home</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.14 * scroll.scrollHeight), toggle()
                )}
              >
                <span>About</span>About<span>About</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.26 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Technics</span>Technics<span>Technics</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.43 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Collaborate</span>Collaborate<span>Collaborate</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.49 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Ventures</span>Ventures
                <span>Ventures</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.58 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Partners</span>Partners<span>Partners</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.67 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Team</span>Team<span>Team</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.737 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Build with us</span>Build with us<span>Build with us</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.83 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Blog</span>Blog<span>Blog</span>
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.92 * scroll.scrollHeight), toggle()
                )}
              >
                <span>Contact</span>Contact<span>Contact</span>
              </button>
            </li>
          </ul>
        </div>
        <Social className={styles.menuSocial} />
      </div>

      <button
        onClick={toggle}
        type={"button"}
        className={`${styles.menuButton} ${showMenu ? styles.active : ""} ${
          fixed ? styles.fixed : null
        }`}
      >
        <div className={styles.line}></div>
        <div className={styles.lineDouble}>
          <div className={styles.doub}></div>
          <div className={styles.doub}></div>
        </div>
        <div className={styles.line}></div>
      </button>
    </>
  );
};

export default Menu;
