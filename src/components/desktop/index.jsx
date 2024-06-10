import React, { useRef, Suspense } from "react";
import * as THREE from "three";
import styles from "./index.module.scss";
import { useFrame } from "@react-three/fiber";
import {
  ScrollControls,
  Scroll,
  useScroll,
} from "@react-three/drei";
import Model from "../../../src/components/Dao2";
import Effects from "../../../src/components/eff";
import Logo from "../../../src/components/logo";
import Hero from "./home/hero";
import About from "./home/about";
import Services from "./home/services";
import Work from "./home/work";
import Contact from "./home/contact";
import Blog from "./home/blog";
import Projects from "./home/projects";
import Build from "./home/build";
import Menu from "./home/menu";
import References from "./home/references";
import Team from "./home/team";

/* DESKTOP  */
export default function Desktop() {
  return (
    <Suspense fallback={null}>
      <ScrollContentDesktop />
      <Rig />
    </Suspense>
  );
}

// Change vector3 with mouse position
function Rig({ v = new THREE.Vector3() }) {
  return useFrame((state) => {
    state.camera.position.lerp(
      v.set(state.mouse.x / 2, state.mouse.y / 2, 2),
      0.12
    );
  });
}

// Connect model with scroll
function ModelScroll() {
  const scroll = useScroll();
  const controls = useRef(0);

  useFrame((state, delta) => {
    const offset = scroll.offset;
    controls.current = offset;
  });

  return <Model scroll={controls} />;
}

// Section content with breakpoints
function ContentDesktop() {
  const scroll = useScroll();
  const controls = useRef(0);
  const sectionsRef = useRef();
  const pipe = useRef();

  useFrame(() => {
    const r1 = scroll.visible(0, 0.05);
    const r2 = scroll.visible(0.12, 0.08);
    const r3 = scroll.visible(0.24, 0.08);
    const r4 = scroll.visible(0.43, 0.06);
    const r5 = scroll.visible(0.5, 0.08);
    const r6 = scroll.visible(0.59, 0.08);
    const r7 = scroll.visible(0.68, 0.08);
    const r8 = scroll.visible(0.77, 0.08);
    const r9 = scroll.visible(0.86, 0.08);
    const r10 = scroll.visible(0.95, 0.08);
    const scrollPercent = (scroll.el.scrollTop / scroll.el.scrollHeight) * 1;
    const offset = scroll.offset;
    controls.current = offset;

    if (sectionsRef.current) {
      pipe.current.children[0].classList.toggle(styles.active, r1);
      pipe.current.children[1].classList.toggle(styles.active, r2);
      pipe.current.children[2].classList.toggle(styles.active, r3);
      pipe.current.children[3].classList.toggle(styles.active, r4);
      pipe.current.children[4].classList.toggle(styles.active, r5);
      pipe.current.children[5].classList.toggle(styles.active, r6);
      pipe.current.children[6].classList.toggle(styles.active, r7);
      pipe.current.children[7].classList.toggle(styles.active, r8);
      pipe.current.children[8].classList.toggle(styles.active, r9);
      // pipe.current.children[9].classList.toggle(styles.active, r10);

      sectionsRef.current.children[0].classList.toggle("active", r1);
      sectionsRef.current.children[1].classList.toggle("active", r2);
      sectionsRef.current.children[2].classList.toggle("active", r3);
      sectionsRef.current.children[3].classList.toggle("active", r4);
      sectionsRef.current.children[4].classList.toggle("active", r5);
      sectionsRef.current.children[5].classList.toggle("active", r6);
      sectionsRef.current.children[6].classList.toggle("active", r7);
      sectionsRef.current.children[7].classList.toggle("active", r8);
      sectionsRef.current.children[8].classList.toggle("active", r9);
      // sectionsRef.current.children[9].classList.toggle("active", r10);
    }
  });

  return (
    <Scroll ref={sectionsRef} className={styles.main} html>
      <div className={`${styles.section} section`}>
        <Hero scroll={scroll.el} />
      </div>
      <div className={`${styles.section} section`}>
        <About />
      </div>

      <div className={`${styles.section} section`}>
        <Services />
      </div>

      <div className={`${styles.section} section`}>
        <Work scroll={scroll.el} />
      </div>

      <div className={`${styles.section} section`}>
        <Projects scroll={scroll.el} />
      </div>

      <div className={`${styles.section} sectionReferences section references`}>
        <References />
      </div>

      {/* <div className={`${styles.section} section`}>
        <Team />
      </div> */}

      <div className={`${styles.section} section build`}>
        <Build />
      </div>

      <div className={`${styles.section} section`}>
        <Blog />
      </div>

      <div className={`${styles.section} section`}>
        <Contact />
      </div>

      <div className={styles.overlayBox}>
        <Logo position={"absolute"} />
        <Menu scroll={scroll.el} />

        <div ref={pipe} className={styles.controlSections}>
          <button
            type={"button"}
            onClick={() => (scroll.el.scrollTop = 0 * scroll.el.scrollHeight)}
          >
            1
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.14 * scroll.el.scrollHeight)
            }
          >
            2
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.26 * scroll.el.scrollHeight)
            }
          >
            3
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.43 * scroll.el.scrollHeight)
            }
          >
            4
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.52 * scroll.el.scrollHeight)
            }
          >
            5
          </button>
          <button
            type={"button"}
            onClick={() => (scroll.el.scrollTop = 0.6 * scroll.el.scrollHeight)}
          >
            6
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.67 * scroll.el.scrollHeight)
            }
          >
            7
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.737 * scroll.el.scrollHeight)
            }
          >
            8
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.83 * scroll.el.scrollHeight)
            }
          >
            9
          </button>
          {/* <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.92 * scroll.el.scrollHeight)
            }
          >
            10
          </button> */}
        </div>
      </div>
      <Effects />
    </Scroll>
  );
}

// Mount content on desktop
function ScrollContentDesktop() {
  return (
    <ScrollControls damping={5} distance={16} pages={1}>
      <ModelScroll />
      <ContentDesktop />
    </ScrollControls>
  );
}
