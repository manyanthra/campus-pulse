
const h = React.createElement;

function MaintenanceGuide() {
    const [status, setStatus] = React.useState("Submitted");

    const descriptions = {
        "Submitted": "Your maintenance complaint has been successfully registered.",
        "Assigned": "An admin has assigned your complaint to a maintenance worker.",
        "In Progress": "The maintenance worker is currently resolving your issue.",
        "Closed": "Your complaint has been resolved and officially closed."
    };

    const statuses = ["Submitted", "Assigned", "In Progress", "Closed"];

    return h("div", {
        style: {
            background: "#fffaf7",
            border: "1px solid #f0d9d0",
            borderRadius: "18px",
            padding: "22px",
            margin: "20px",
            color: "#3d2f3a"
        }
    },
        h("h2", null, "🔧 Maintenance Ticket Guide"),

        h("p", null, "Explore the different stages of a CampusPulse complaint."),

        h("div", {
            style: {
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                margin: "15px 0"
            }
        },
            ...statuses.map(item =>
                h("button", {
                    key: item,
                    onClick: () => setStatus(item),
                    style: {
                        padding: "10px 15px",
                        border: "none",
                        borderRadius: "20px",
                        background: status === item ? "#f2b5b0" : "#fdf3ee",
                        color: "#3d2f3a",
                        cursor: "pointer",
                        fontWeight: "bold"
                    }
                }, item)
            )
        ),

        h("div", {
            style: {
                background: "#fdf3ee",
                padding: "15px",
                borderRadius: "12px"
            }
        },
            h("h3", null, "Current Stage: " + status),
            h("p", null, descriptions[status])
        )
    );
}

const root = ReactDOM.createRoot(
    document.getElementById("react-maintenance")
);

root.render(h(MaintenanceGuide));
