export default (): Date => {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
}