import { motion } from "framer-motion";
import DebugSection from "../DebugSection";

const DeveloperTab = () => (
    <motion.div
        key="developer"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.15 }}
        className="p-6"
    >
        <DebugSection />
    </motion.div>
);

export default DeveloperTab;
